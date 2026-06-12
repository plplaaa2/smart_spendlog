package com.spendlog.android.api

import android.content.Context
import android.util.Log
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import com.spendlog.android.parser.asLongOrNull
import com.spendlog.android.parser.asBooleanOrNull
import com.spendlog.android.parser.asStringOrNull
import androidx.room.withTransaction
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file SettingsApiHandler.kt
 * @summary 설정 관리 및 백업/복원 API 요청 처리 모듈
 * @description 가계부 사용자 설정 저장/조회, 전체 데이터를 평문 JSON 구조로 직렬화하여 백업하는 기능,
 *              그리고 Room 데이터베이스 트랜잭션 내에서 모든 테이블을 리셋하고 데이터 세트를 일괄 복원하는 기능을 담당합니다.
 * @dependencies
 *   - AndroidApiHandler.kt (공통 DB 헬퍼 및 JSON 직렬화기 사용)
 *   - Entities.kt / Daos.kt (Room DB 엔티티 및 DAO 인터페이스)
 */
object SettingsApiHandler {

    suspend fun handleSettingsRequest(
        context: Context,
        db: SpendLogDatabase,
        path: String,
        method: String,
        body: String?
    ): ApiResponse {
        val json = AndroidApiHandler.json

        return when {
            path == "settings/backup" -> {
                val categories = db.categoryDao().getAllCategories()
                val payMethods = db.payMethodDao().getAllPayMethods()
                val rules = db.ruleDao().getAllRules()
                val transactions = db.transactionDao().getAllTransactions()
                val merchantCategories = db.merchantCategoryDao().getAllMerchantCategories()
                val packagePayMethods = db.packagePayMethodDao().getAllPackagePayMethods()
                val passRules = db.passRuleDao().getAllPassRules()
                
                val settingsObj = db.settingsDao().getSettings() ?: Settings()
                val settingsList = listOf(
                    buildJsonObject { put("key", "monthly_budget"); put("value", settingsObj.monthlyBudget.toString()) },
                    buildJsonObject { put("key", "user_real_name"); put("value", settingsObj.userRealName) },
                    buildJsonObject { put("key", "auto_rule_generation"); put("value", settingsObj.autoRuleGeneration.toString()) },
                    buildJsonObject { put("key", "initial_balances"); put("value", settingsObj.initial_balances ?: "{}") },
                    buildJsonObject { put("key", "initial_points"); put("value", settingsObj.initial_points ?: "{}") },
                    buildJsonObject { put("key", "card_performance_days"); put("value", settingsObj.card_performance_days ?: "{}") },
                    buildJsonObject { put("key", "pay_methods_order"); put("value", settingsObj.pay_methods_order ?: "[]") },
                    buildJsonObject { put("key", "card_performance_goals"); put("value", settingsObj.card_performance_goals ?: "{}") }
                )
                
                val dataObj = buildJsonObject {
                    put("categories", json.encodeToJsonElement(categories))
                    put("pay_methods", json.encodeToJsonElement(payMethods))
                    put("rules", json.encodeToJsonElement(rules))
                    put("transactions", json.encodeToJsonElement(transactions))
                    put("merchant_categories", json.encodeToJsonElement(merchantCategories))
                    put("package_pay_methods", json.encodeToJsonElement(packagePayMethods))
                    put("settings", JsonArray(settingsList))
                    put("pass_rules", json.encodeToJsonElement(passRules))
                }
                
                val backupObj = buildJsonObject {
                    put("version", "1.9.20")
                    put("username", "admin")
                    put("backup_date", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date()))
                    put("data", dataObj)
                }
                
                ApiResponse(body = buildJsonObject {
                    put("success", true)
                    put("backupData", backupObj)
                })
            }
            path == "settings/restore" -> {
                if (method == "POST" && body != null) {
                    try {
                        val backupObj = json.parseToJsonElement(body).jsonObject
                        val dataObject = if (backupObj.containsKey("data")) {
                            backupObj["data"]?.jsonObject
                        } else if (backupObj.containsKey("isEncrypted") && backupObj["isEncrypted"]?.jsonPrimitive?.boolean == true) {
                            return ApiResponse(status = 400, body = buildJsonObject { 
                                put("success", false)
                                put("error", "모바일 앱 가계부에서는 암호화가 해제된 평문 JSON 파일만 복원 가능합니다. 오리지널 가계부에서 암호화를 해제 후 내보내기 해주십시오.") 
                            })
                        } else {
                            backupObj
                        }

                        if (dataObject != null) {
                            var restoreError: String? = null
                            
                            try {
                                db.withTransaction {
                                    try {
                                            db.openHelper.writableDatabase.let { sqlDb ->
                                                sqlDb.execSQL("DELETE FROM categories")
                                                sqlDb.execSQL("DELETE FROM pay_methods")
                                                sqlDb.execSQL("DELETE FROM rules")
                                                sqlDb.execSQL("DELETE FROM transactions")
                                                sqlDb.execSQL("DELETE FROM merchant_categories")
                                                sqlDb.execSQL("DELETE FROM package_pay_methods")
                                                sqlDb.execSQL("DELETE FROM pass_rules")
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "데이터베이스 초기화 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["categories"]?.jsonArray?.let { arr ->
                                                val list = json.decodeFromJsonElement<List<Category>>(arr)
                                                db.categoryDao().insertCategories(list)
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "카테고리(categories) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            val bankKeywords = listOf("은행", "뱅크", "bank", "Bank")
                                            dataObject["pay_methods"]?.jsonArray?.let { arr ->
                                                val list = arr.map { elem ->
                                                    val obj = elem.jsonObject
                                                    val name = obj["name"]?.jsonPrimitive?.contentOrNull ?: ""
                                                    val typeFromJson = obj["type"]?.jsonPrimitive?.contentOrNull
                                                    val resolvedType = when {
                                                        typeFromJson != null -> typeFromJson
                                                        bankKeywords.any { name.contains(it) } -> "BANK"
                                                        else -> "CARD"
                                                    }
                                                    PayMethod(name = name, type = resolvedType)
                                                }
                                                db.payMethodDao().insertPayMethods(list)
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "결제수단(pay_methods) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["rules"]?.jsonArray?.let { arr ->
                                                val list = arr.map { elem ->
                                                    val obj = elem.jsonObject
                                                    Rule(
                                                        id = obj["id"]?.jsonPrimitive?.intOrNull ?: 0,
                                                        name = obj["name"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        pattern = obj["pattern"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        category = obj["category"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        payMethod = obj["pay_method"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        merchantTemplate = obj["merchant_template"]?.jsonPrimitive?.contentOrNull ?: "\${merchant}",
                                                        type = obj["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE"
                                                    )
                                                }
                                                list.forEach { db.ruleDao().insertRule(it) }
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "자동규칙(rules) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["transactions"]?.jsonArray?.let { arr ->
                                                val list = arr.map { elem ->
                                                    val obj = elem.jsonObject
                                                    Transaction(
                                                        id = obj["id"]?.jsonPrimitive?.longOrNull ?: 0L,
                                                        type = obj["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE",
                                                        amount = obj["amount"]?.jsonPrimitive?.longOrNull ?: 0L,
                                                        merchant = obj["merchant"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        category = obj["category"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        payMethod = obj["pay_method"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        datetime = obj["datetime"]?.jsonPrimitive?.contentOrNull ?: "",
                                                        memo = obj["memo"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull ?: "",
                                                        rawText = obj["raw_text"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull ?: "",
                                                        usedPoint = obj["used_point"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.longOrNull ?: 0L
                                                    )
                                                }
                                                list.forEach { db.transactionDao().insertTransaction(it) }
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "거래내역(transactions) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["merchant_categories"]?.jsonArray?.let { arr ->
                                                val list = json.decodeFromJsonElement<List<MerchantCategory>>(arr)
                                                db.merchantCategoryDao().insertMerchantCategories(list)
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "사용처카테고리(merchant_categories) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["package_pay_methods"]?.jsonArray?.let { arr ->
                                                val list = json.decodeFromJsonElement<List<PackagePayMethod>>(arr)
                                                list.forEach { db.packagePayMethodDao().insertPackagePayMethod(it) }
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "앱결제수단(package_pay_methods) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["pass_rules"]?.jsonArray?.let { arr ->
                                                val list = json.decodeFromJsonElement<List<PassRule>>(arr)
                                                list.forEach { db.passRuleDao().insertPassRule(it) }
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "제외규칙(pass_rules) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }

                                        try {
                                            dataObject["settings"]?.jsonArray?.let { arr ->
                                                var budget: Long = 0
                                                var name: String = "사용자"
                                                var autoRule = true
                                                var initialBalances: String? = null
                                                var initialPoints: String? = null
                                                var cardPerformanceDays: String? = null
                                                var payMethodsOrder: String? = null
                                                var cardPerformanceGoals: String? = null
                                                
                                                val firstItem = arr.firstOrNull()?.jsonObject
                                                if (firstItem != null) {
                                                    if (firstItem.containsKey("monthlyBudget") || firstItem.containsKey("userRealName")) {
                                                        budget = firstItem["monthlyBudget"]?.jsonPrimitive?.longOrNull ?: 0L
                                                        name = firstItem["userRealName"]?.jsonPrimitive?.contentOrNull ?: "사용자"
                                                        autoRule = firstItem["autoRuleGeneration"]?.jsonPrimitive?.booleanOrNull ?: true
                                                        initialBalances = firstItem["initial_balances"]?.jsonPrimitive?.contentOrNull
                                                        initialPoints = firstItem["initial_points"]?.jsonPrimitive?.contentOrNull
                                                        cardPerformanceDays = firstItem["card_performance_days"]?.jsonPrimitive?.contentOrNull
                                                        payMethodsOrder = firstItem["pay_methods_order"]?.jsonPrimitive?.contentOrNull
                                                        cardPerformanceGoals = firstItem["card_performance_goals"]?.jsonPrimitive?.contentOrNull
                                                    } else {
                                                        arr.forEach { element ->
                                                            val obj = element.jsonObject
                                                            val key = obj["key"]?.jsonPrimitive?.contentOrNull
                                                            val value = obj["value"]?.jsonPrimitive?.contentOrNull
                                                            if (key != null && value != null) {
                                                                when (key) {
                                                                    "monthly_budget", "monthlyBudget" -> budget = value.toLongOrNull() ?: 0L
                                                                    "user_real_name", "userRealName" -> name = value
                                                                    "auto_rule_generation", "autoRuleGeneration" -> autoRule = value.toBooleanStrictOrNull() ?: true
                                                                    "initial_balances" -> initialBalances = value
                                                                    "initial_points" -> initialPoints = value
                                                                    "card_performance_days" -> cardPerformanceDays = value
                                                                    "pay_methods_order" -> payMethodsOrder = value
                                                                    "card_performance_goals" -> cardPerformanceGoals = value
                                                                }
                                                            }
                                                         }
                                                    }
                                                }
                                                val settings = Settings(
                                                    id = 0, 
                                                    monthlyBudget = budget, 
                                                    userRealName = name, 
                                                    autoRuleGeneration = autoRule,
                                                    initial_balances = initialBalances,
                                                    initial_points = initialPoints,
                                                    card_performance_days = cardPerformanceDays,
                                                    pay_methods_order = payMethodsOrder,
                                                    card_performance_goals = cardPerformanceGoals
                                                )
                                                db.settingsDao().insertSettings(settings)
                                            }
                                        } catch (e: Exception) {
                                            restoreError = "설정(settings) 데이터 복원 실패: ${e.message}"
                                            throw e
                                        }
                                }
                            } catch (transactionEx: Exception) {
                                // Transaction 롤백됨
                            }

                            if (restoreError != null) {
                                ApiResponse(status = 400, body = buildJsonObject { 
                                    put("success", false)
                                    put("error", restoreError) 
                                })
                            } else {
                                MainActivity.refreshUI()
                                ApiResponse(body = buildJsonObject { put("success", true) })
                            }
                        } else {
                            ApiResponse(status = 400, body = buildJsonObject { put("success", false); put("error", "올바른 백업 데이터 포맷이 아닙니다.") })
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                        ApiResponse(status = 500, body = buildJsonObject { 
                            put("success", false)
                            put("error", "복원 과정 중 치명적 오류 발생: ${e.message}") 
                        })
                    }
                } else {
                    ApiResponse(status = 405, body = buildJsonObject { put("error", "Method Not Allowed") })
                }
            }
            path.startsWith("settings") -> {
                if (method == "POST" && body != null) {
                    val bodyObj = json.parseToJsonElement(body).jsonObject
                    
                    // 1. Reset Balance API
                    if (path == "settings/reset-balance") {
                        Log.i("SettingsApiHandler", "Reset balance request received.")
                        // 현재 구조상 별도의 잔액 테이블이 없으므로, 필요 시 거래 내역 초기화나 특정 설정값 리셋 로직을 여기에 추가합니다.
                        // 일단은 로그를 남기고 성공 응답을 반환합니다.
                        MainActivity.refreshUI()
                        return ApiResponse(body = buildJsonObject { put("success", true) })
                    }

                    // 2. Reset All API
                    if (path == "settings/reset-all") {
                        Log.i("SettingsApiHandler", "Reset all request received.")
                        try {
                            db.withTransaction {
                                db.openHelper.writableDatabase.let { sqlDb ->
                                    sqlDb.execSQL("DELETE FROM categories")
                                    sqlDb.execSQL("DELETE FROM pay_methods")
                                    sqlDb.execSQL("DELETE FROM rules")
                                    sqlDb.execSQL("DELETE FROM transactions")
                                    sqlDb.execSQL("DELETE FROM merchant_categories")
                                    sqlDb.execSQL("DELETE FROM package_pay_methods")
                                    sqlDb.execSQL("DELETE FROM pass_rules")
                                }
                            }
                            MainActivity.refreshUI()
                            return ApiResponse(body = buildJsonObject { put("success", true) })
                        } catch (e: Exception) {
                            Log.e("SettingsApiHandler", "Reset all failed: ${e.message}")
                            return ApiResponse(status = 500, body = buildJsonObject { 
                                put("success", false)
                                put("error", "전체 데이터 초기화 중 오류 발생: ${e.message}") 
                            })
                        }
                    }

                    // 3. Standard Settings Update (Refined with Logging and Type Safety)
                    Log.i("SettingsApiHandler", "Received settings update request: $body")
                    val currentSettings = db.settingsDao().getSettings() ?: Settings()
                    
                    var monthlyBudget = currentSettings.monthlyBudget
                    if (bodyObj.containsKey("monthly_budget")) {
                        monthlyBudget = bodyObj["monthly_budget"].asLongOrNull() ?: monthlyBudget
                    }
                    if (bodyObj.containsKey("monthlyBudget")) {
                        monthlyBudget = bodyObj["monthlyBudget"].asLongOrNull() ?: monthlyBudget
                    }

                    var userRealName = currentSettings.userRealName
                    if (bodyObj.containsKey("user_real_name")) {
                        userRealName = bodyObj["user_real_name"].asStringOrNull() ?: userRealName
                    }

                    var autoRuleGeneration = currentSettings.autoRuleGeneration
                    if (bodyObj.containsKey("auto_rule_generation")) {
                        autoRuleGeneration = bodyObj["auto_rule_generation"].asBooleanOrNull() ?: autoRuleGeneration
                    }

                    var initialBalance = currentSettings.initial_balance
                    if (bodyObj.containsKey("initial_balance")) {
                        initialBalance = bodyObj["initial_balance"].asLongOrNull() ?: initialBalance
                    }

                    var initialBalances = currentSettings.initial_balances
                    if (bodyObj.containsKey("initial_balances")) {
                        initialBalances = bodyObj["initial_balances"].asStringOrNull() ?: initialBalances
                    }

                    var initialPoints = currentSettings.initial_points
                    if (bodyObj.containsKey("initial_points")) {
                        initialPoints = bodyObj["initial_points"].asStringOrNull() ?: initialPoints
                    }

                    var cardPerformanceDays = currentSettings.card_performance_days
                    if (bodyObj.containsKey("card_performance_days")) {
                        cardPerformanceDays = bodyObj["card_performance_days"].asStringOrNull() ?: cardPerformanceDays
                    }

                    var cardPerformanceGoals = currentSettings.card_performance_goals
                    if (bodyObj.containsKey("card_performance_goals")) {
                        cardPerformanceGoals = bodyObj["card_performance_goals"].asStringOrNull() ?: cardPerformanceGoals
                    }

                    var payMethodsOrder = currentSettings.pay_methods_order
                    if (bodyObj.containsKey("pay_methods_order")) {
                        payMethodsOrder = bodyObj["pay_methods_order"].asStringOrNull() ?: payMethodsOrder
                    }

                    var aiEnabled = currentSettings.ai_enabled
                    if (bodyObj.containsKey("ai_enabled")) {
                        aiEnabled = bodyObj["ai_enabled"].asBooleanOrNull() ?: aiEnabled
                    }

                    var aiParsingEnabled = currentSettings.ai_parsing_enabled
                    if (bodyObj.containsKey("ai_parsing_enabled")) {
                        aiParsingEnabled = bodyObj["ai_parsing_enabled"].asBooleanOrNull() ?: aiParsingEnabled
                    }

                    var aiProvider = currentSettings.ai_provider
                    if (bodyObj.containsKey("ai_provider")) {
                        aiProvider = bodyObj["ai_provider"].asStringOrNull() ?: aiProvider
                    }

                    var aiApiKey = currentSettings.ai_api_key
                    if (bodyObj.containsKey("ai_api_key")) {
                        aiApiKey = bodyObj["ai_api_key"].asStringOrNull() ?: aiApiKey
                    }

                    var aiLocalIp = currentSettings.ai_local_ip
                    if (bodyObj.containsKey("ai_local_ip")) {
                        aiLocalIp = bodyObj["ai_local_ip"].asStringOrNull() ?: aiLocalIp
                    }

                    var aiLocalModel = currentSettings.ai_local_model
                    if (bodyObj.containsKey("ai_local_model")) {
                        aiLocalModel = bodyObj["ai_local_model"].asStringOrNull() ?: aiLocalModel
                    }

                    val newSettings = Settings(
                        id = 0,
                        monthlyBudget = monthlyBudget,
                        userRealName = userRealName,
                        autoRuleGeneration = autoRuleGeneration,
                        initial_balance = initialBalance,
                        initial_balances = initialBalances,
                        initial_points = initialPoints,
                        card_performance_days = cardPerformanceDays,
                        card_performance_goals = cardPerformanceGoals,
                        pay_methods_order = payMethodsOrder,
                        ai_enabled = aiEnabled,
                        ai_parsing_enabled = aiParsingEnabled,
                        ai_provider = aiProvider,
                        ai_api_key = aiApiKey,
                        ai_local_ip = aiLocalIp,
                        ai_local_model = aiLocalModel
                    )

                    db.settingsDao().insertSettings(newSettings)
                    Log.i("SettingsApiHandler", "Successfully updated settings: $newSettings")
                    MainActivity.refreshUI()
                    ApiResponse(body = buildJsonObject { put("success", true) })
                } else {
                    val settings = db.settingsDao().getSettings() ?: Settings()
                    val initialBalancesJson = try {
                        settings.initial_balances?.let { json.parseToJsonElement(it) } ?: buildJsonObject {}
                    } catch (e: Exception) { buildJsonObject {} }
                    val initialPointsJson = try {
                        settings.initial_points?.let { json.parseToJsonElement(it) } ?: buildJsonObject {}
                    } catch (e: Exception) { buildJsonObject {} }
                    val cardPerformanceDaysJson = try {
                        settings.card_performance_days?.let { json.parseToJsonElement(it) } ?: buildJsonObject {}
                    } catch (e: Exception) { buildJsonObject {} }
                    val cardPerformanceGoalsJson = try {
                        settings.card_performance_goals?.let { json.parseToJsonElement(it) } ?: buildJsonObject {}
                    } catch (e: Exception) { buildJsonObject {} }

                    val resBody = buildJsonObject {
                        put("monthly_budget", settings.monthlyBudget)
                        put("user_real_name", settings.userRealName)
                        put("auto_rule_generation", settings.autoRuleGeneration.toString())
                        put("initial_balance", settings.initial_balance)
                        put("initial_balances", initialBalancesJson)
                        put("initial_points", initialPointsJson)
                        put("card_performance_days", cardPerformanceDaysJson)
                        put("card_performance_goals", cardPerformanceGoalsJson)
                        put("pay_methods_order", settings.pay_methods_order?.let { 
                            try { json.parseToJsonElement(it) } catch(e: Exception) { buildJsonArray {} }
                        } ?: buildJsonArray {})
                        put("ai_enabled", settings.ai_enabled.toString())
                        put("ai_parsing_enabled", settings.ai_parsing_enabled.toString())
                        put("ai_provider", settings.ai_provider)
                        put("ai_api_key", settings.ai_api_key)
                        put("ai_local_ip", settings.ai_local_ip)
                        put("ai_local_model", settings.ai_local_model)
                    }
                    ApiResponse(body = resBody)
                }
            }
            else -> ApiResponse(status = 404, body = buildJsonObject { put("error", "Not Found") })
        }
    }
}