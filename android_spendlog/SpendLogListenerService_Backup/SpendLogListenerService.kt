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

        val amountPattern = Regex("""(?:\d{1,3}(?:,\d{3})+|\d+\s*원|\d+\s*USD|\d+\s*달러|[₩$]\s*\d+)""")
        if (!amountPattern.containsMatchIn(rawText)) {
            Log.d(TAG, "Notification skipped (No amount pattern detected): $rawText")
            return
        }

        processNotification(packageName, rawText, title, text)
    }

    private fun processNotification(sender: String, rawText: String, title: String, text: String) {
        serviceScope.launch {
            val db = SpendLogDatabase.getDatabase(applicationContext)
            
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
                // com.spendlog.android.MainActivity.refreshUI()
                return@launch
            }

            // 2. Parse Notification
            val rules = db.ruleDao().getAllRules()
            val result = NotificationParser.parseNotification(rawText, rules)
            
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
                db.transactionDao().insertTransaction(transaction)
                Log.d(TAG, "Transaction saved: ${result.merchant} - ${result.amount}")
                // com.spendlog.android.MainActivity.refreshUI()
            } else {
                parsedStatus = "FAILED"
                Log.d(TAG, "Parsing failed for: $rawText")
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
        }
    }
}