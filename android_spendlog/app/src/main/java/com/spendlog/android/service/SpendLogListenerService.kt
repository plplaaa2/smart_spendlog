package com.spendlog.android.service

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.*
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// Data 및 Parser 패키지 명시적 임포트 확인
import com.spendlog.android.data.SpendLogDatabase
import com.spendlog.android.data.NotificationLog
import com.spendlog.android.data.Transaction
import com.spendlog.android.parser.NotificationParser

class SpendLogListenerService : NotificationListenerService() {

    private val TAG = "SpendLogListener"
    private val serviceScope = CoroutineScope(Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        val extras = sbn.notification.extras
        val title = extras.getString("android.title") ?: ""
        val text = extras.getString("android.text") ?: ""

        if (title.isEmpty() && text.isEmpty()) return

        Log.d(TAG, "Notification received from $packageName: $title - $text")

        val rawText = if (title.isNotEmpty() && text.isNotEmpty() && title != text) {
            "[$title] $text"
        } else {
            text.ifEmpty { title }
        }
        val trimmedRawText = rawText.trim()

        // [인증/보안/광고 스팸 필터링]
        // - 요약: 가계부 등록 대상이 아닌 광고나 본인인증 번호 등의 알림은 즉시 무시합니다.
        // - 연결된 파일 목록:
        //   - webhook.js (동일 정규식 공유)
        val excludePattern = Regex("""(?:\(광고\)|\[광고\]|^광고|인증번호|인증\s*번호|인증코드|인증\s*코드|본인\s*인증|본인\s*확인|인증문자|인증요청|임시\s*비밀번호|임시\s*비밀\s*번호|OTP|이벤트|혜택|쿠폰|특가)""", RegexOption.IGNORE_CASE)
        if (excludePattern.containsMatchIn(trimmedRawText)) {
            Log.d(TAG, "Notification skipped (Spam/Ad/Auth notification): $trimmedRawText")
            return
        }

        processNotification(packageName, trimmedRawText, title, text)
    }

    private fun processNotification(sender: String, rawText: String, title: String, text: String) {
        serviceScope.launch {
            val db = SpendLogDatabase.getDatabase(applicationContext)
            
            // 중복 수신 알림 필터링 (최근 3초 이내 동일 rawText 존재 시 스킵)
            val threshold = System.currentTimeMillis() - 3000
            val duplicateCount = db.notificationLogDao().countDuplicateLogs(rawText, threshold)
            if (duplicateCount > 0) {
                Log.d(TAG, "Duplicate notification skip: $rawText")
                return@launch
            }
            
            // 1. Check Pass Rules
            val passRules = db.passRuleDao().getAllPassRules()
            if (NotificationParser.checkPassRules(rawText, passRules)) {
                val log = NotificationLog(
                    sender = sender,
                    rawText = rawText,
                    title = title,
                    text = text,
                    parsedStatus = "PASS",
                    matchedRuleId = null
                )
                db.notificationLogDao().insertLog(log)
                Log.d(TAG, "Notification passed: $rawText")
                com.spendlog.android.MainActivity.refreshUI()
                return@launch
            }

            // 2. Parse Notification
            val rules = db.ruleDao().getAllRules()
            var result = NotificationParser.parseNotification(rawText, rules, db, sender)
            
            // Fallback: If rawText (with title) didn't match any rules, try parsing the body text alone.
            // This ensures compatibility with rules written for the message body.
            if (result == null && text.isNotEmpty()) {
                result = NotificationParser.parseNotification(text, rules, db, sender)
            }
            
            val parsedStatus: String
            var matchedRuleId: Int? = null
            
            if (result != null) {
                parsedStatus = "SUCCESS"
                matchedRuleId = result.ruleId
                
                val transaction = Transaction(
                    type = result.type,
                    amount = result.amount,
                    merchant = result.merchant,
                    category = result.category,
                    payMethod = result.payMethod,
                    payType = result.payType,
                    datetime = result.datetime,
                    memo = result.memo,
                    rawText = rawText,
                    usedPoint = result.usedPoint
                )
                
                // 1분 이내 동일 금액 거래 중복 차단 검사 (체크카드 승인 후 은행 연쇄 출금 중복 감지 포함)
                var isDuplicateTx = false
                try {
                    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                    val parsedDate = sdf.parse(result.datetime)
                    if (parsedDate != null) {
                        val minTime = parsedDate.time - 60000 // 1분 전
                        val minDatetimeStr = sdf.format(Date(minTime))
                        val candidates = db.transactionDao().getTransactionsNearByAmount(result.amount, minDatetimeStr)
                        
                        for (tx in candidates) {
                            val cleanExisting = tx.merchant.replace(Regex("[^a-zA-Z0-9가-힣]"), "")
                            val cleanCurrent = result.merchant.replace(Regex("[^a-zA-Z0-9가-힣]"), "")
                            
                            val isSimilarMerchant = cleanExisting.contains(cleanCurrent) || 
                                                    cleanCurrent.contains(cleanExisting) ||
                                                    cleanExisting == cleanCurrent
                            
                            val isCheck1 = tx.payType == "CHECK" || tx.rawText?.contains("체크") == true || tx.payMethod.contains("체크")
                            val isCheck2 = result.payType == "CHECK" || rawText.contains("체크") || result.payMethod.contains("체크")
                            
                            val isTransfer1 = tx.payType == "TRANSFER" || tx.payType == "CASH"
                            val isTransfer2 = result.payType == "TRANSFER" || result.payType == "CASH"
                            
                            val cardCompanyRegex = Regex("(카드|삼성|현대|롯데|신한|국민|우리|하나|농협|비씨|실적|승인|체크)")
                            
                            var isCheckCardDoubleNotification = false
                            if (isCheck1 && isTransfer2 && cardCompanyRegex.containsMatchIn(result.merchant)) {
                                isCheckCardDoubleNotification = true
                            }
                            if (isTransfer1 && isCheck2 && cardCompanyRegex.containsMatchIn(tx.merchant)) {
                                isCheckCardDoubleNotification = true
                            }
                            
                            if (isSimilarMerchant || isCheckCardDoubleNotification) {
                                isDuplicateTx = true
                                break
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking duplicate transaction", e)
                }

                if (isDuplicateTx) {
                    Log.d(TAG, "Duplicate transaction skip: ${result.merchant} - ${result.amount}")
                } else {
                    db.transactionDao().insertTransaction(transaction)
                    Log.d(TAG, "Transaction saved: ${result.merchant} - ${result.amount}")
                }
            } else {
                parsedStatus = "FAILED"
                Log.d(TAG, "Parsing failed for: $rawText (also tried body: $text)")
            }

            // 백엔드 webhook.js와 수집 일치화: 금액이 있거나 파싱에 성공한 알림만 로그 DB에 기록
            val hasAmount = Regex("""(?:\d+[,.\d]*\s*원|[₩$]\s*\d+[,.\d]*|\\\s*\d+[,.\d]*|\b\d{1,3}(,\d{3})+\b)""").containsMatchIn(rawText)
            if (hasAmount || parsedStatus == "SUCCESS") {
                val log = NotificationLog(
                    sender = sender,
                    rawText = rawText,
                    title = title,
                    text = text,
                    parsedStatus = parsedStatus,
                    matchedRuleId = matchedRuleId
                )
                db.notificationLogDao().insertLog(log)
            }
            com.spendlog.android.MainActivity.refreshUI()
        }
    }
}
