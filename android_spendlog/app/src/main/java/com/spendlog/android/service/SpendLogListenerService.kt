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

        // Improved amount pattern to catch more variations (e.g., symbols, different spacing)
        val amountPattern = Regex("""(?:\d{1,3}(?:,\d{3})+|\d+\s*원|\d+\s*USD|\d+\s*달러|[₩$]\s*\d+|\d+\s*€|\d+\s*¥|\d+\s*won)""", RegexOption.IGNORE_CASE)
        
        if (!amountPattern.containsMatchIn(trimmedRawText)) {
            Log.d(TAG, "Notification skipped (No amount pattern detected): $trimmedRawText")
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
                    datetime = result.datetime,
                    memo = result.memo,
                    rawText = rawText,
                    usedPoint = result.usedPoint
                )
                
                // 1분 이내 동일 가맹점+금액 거래 중복 차단 검사
                var isDuplicateTx = false
                try {
                    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                    val parsedDate = sdf.parse(result.datetime)
                    if (parsedDate != null) {
                        val minTime = parsedDate.time - 60000 // 1분 전
                        val minDatetimeStr = sdf.format(Date(minTime))
                        val dupCount = db.transactionDao().countDuplicateNear(result.amount, result.merchant, minDatetimeStr)
                        if (dupCount > 0) {
                            isDuplicateTx = true
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

            // Always log the notification attempt
            val log = NotificationLog(
                sender = sender,
                rawText = rawText,
                title = title,
                text = text,
                parsedStatus = parsedStatus,
                matchedRuleId = matchedRuleId
            )
            db.notificationLogDao().insertLog(log)
            com.spendlog.android.MainActivity.refreshUI()
        }
    }
}
