package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import com.spendlog.android.parser.AIConfig
import com.spendlog.android.parser.NotificationParser
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file AndroidApiHandler.kt
 * @summary WebView에서 요청되는 RESTful 모방 API 통신 처리기
 * @description WebView 네이티브 브릿지에서 전달된 HTTP Method 및 Endpoint 경로를 해석하여
 *              Room SQLite DB 쿼리 실행, 응답 JSON 조립, 권한 팝업 호출 등을 일괄 수행합니다.
 * @dependencies
 *   - MainActivity.kt: refreshUI, ApiResponse
 *   - Entities.kt / Daos.kt: 가계부 데이터베이스 스키마 및 CRUD 인터페이스
 *   - NotificationParser.kt: 알림 파싱 및 AI 패턴 매핑 기능
 */
object AndroidApiHandler {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private fun queryRaw(db: SpendLogDatabase, sql: String, args: Array<out Any?>? = null): JsonArray {
        val dbHelper = db.openHelper.readableDatabase
        val cursor = if (args != null) {
            val stringArgs = args.map { it?.toString() ?: "" }.toTypedArray()
            dbHelper.query(sql, stringArgs)
        } else {
            dbHelper.query(sql)
        }
        
        return buildJsonArray {
            cursor.use { c ->
                val columnNames = c.columnNames
                while (c.moveToNext()) {
                    add(buildJsonObject {
                        for (i in 0 until c.columnCount) {
                            val name = columnNames[i]
                            when (c.getType(i)) {
                                android.database.Cursor.FIELD_TYPE_NULL -> put(name, JsonNull)
                                android.database.Cursor.FIELD_TYPE_INTEGER -> put(name, c.getLong(i))
                                android.database.Cursor.FIELD_TYPE_FLOAT -> put(name, c.getDouble(i))
                                android.database.Cursor.FIELD_TYPE_STRING -> put(name, c.getString(i))
                                android.database.Cursor.FIELD_TYPE_BLOB -> put(name, c.getBlob(i).toString())
                            }
                        }
                    })
                }
            }
        }
    }

    private fun queryRawSingle(db: SpendLogDatabase, sql: String, args: Array<out Any?>? = null): JsonObject? {
        return queryRaw(db, sql, args).firstOrNull()?.jsonObject
    }

    private suspend fun seedFranchisePresets(context: Context, db: SpendLogDatabase): Int {
        return try {
            val presets = com.spendlog.android.parser.FranchisePresets.loadPresets(context)
            val merchantCategories = presets.map {
                MerchantCategory(merchant = it.keyword, category = it.category)
            }
            db.merchantCategoryDao().deleteAllMerchantCategories()
            db.merchantCategoryDao().insertMerchantCategories(merchantCategories)
            presets.size
        } catch (e: Exception) {
            e.printStackTrace()
            0
        }
    }

    suspend fun handleApiRequest(
        context: Context,
        db: SpendLogDatabase,
        url: String,
        method: String,
        body: String?
    ): ApiResponse {
        try {
            val fullPath = url.removePrefix("/").removePrefix("api/")
            val path = fullPath.substringBefore("?")
            val queryString = fullPath.substringAfter("?", "")
            val queryParams = if (queryString.isNotEmpty()) {
                queryString.split("&").mapNotNull {
                    val parts = it.split("=", limit = 2)
                    if (parts.size == 2) {
                        val key = java.net.URLDecoder.decode(parts[0], "UTF-8")
                        val value = java.net.URLDecoder.decode(parts[1], "UTF-8")
                        key to value
                    } else null
                }.toMap()
            } else emptyMap()

            android.util.Log.d("SpendLogAPI", "Request path: $path, method: $method, queryParams: $queryParams")

            return when {
                // 주의: merchant_categories, package_pay_methods가 categories, pay_methods보다 먼저 매칭되어야 함
                path.startsWith("merchant_categories") -> {
                    if (path == "merchant_categories/seed-presets" && method == "POST") {
                        val count = seedFranchisePresets(context, db)
                        ApiResponse(body = buildJsonObject { 
                            put("success", true)
                            put("inserted", count)
                            put("updated", 0)
                            put("txUpdated", 0)
                            put("total", count)
                        })
                    } else if (method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val id = jsonObject["id"]?.jsonPrimitive?.contentOrNull?.toIntOrNull()
                        val merchant = jsonObject["merchant"]?.jsonPrimitive?.content ?: ""
                        val category = jsonObject["category"]?.jsonPrimitive?.content ?: ""
                        
                        val entity = if (id != null && id > 0) {
                            MerchantCategory(id = id, merchant = merchant, category = category)
                        } else {
                            MerchantCategory(merchant = merchant, category = category)
                        }
                        db.merchantCategoryDao().insertMerchantCategory(entity)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else if (method == "DELETE") {
                        val id = path.substringAfterLast("/").toIntOrNull()
                        if (id != null) {
                            db.merchantCategoryDao().deleteMerchantCategoryById(id)
                        }
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        val list = db.merchantCategoryDao().getAllMerchantCategories()
                        ApiResponse(body = json.encodeToJsonElement(list))
                    }
                }
                path.startsWith("package_pay_methods") -> {
                    if (method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val id = jsonObject["id"]?.jsonPrimitive?.contentOrNull?.toIntOrNull()
                        val pkg = jsonObject["package"]?.jsonPrimitive?.content ?: ""
                        val payMethod = jsonObject["pay_method"]?.jsonPrimitive?.content ?: ""
                        
                        val entity = if (id != null && id > 0) {
                            PackagePayMethod(id = id, `package` = pkg, pay_method = payMethod)
                        } else {
                            PackagePayMethod(`package` = pkg, pay_method = payMethod)
                        }
                        db.packagePayMethodDao().insertPackagePayMethod(entity)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else if (method == "DELETE") {
                        val id = path.substringAfterLast("/").toIntOrNull()
                        if (id != null) {
                            db.packagePayMethodDao().deletePackagePayMethodById(id)
                        }
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        val list = db.packagePayMethodDao().getAllPackagePayMethods()
                        ApiResponse(body = json.encodeToJsonElement(list))
                    }
                }
                path == "categories" || path.startsWith("categories/") -> {
                    if (method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val name = jsonObject["name"]?.jsonPrimitive?.content ?: ""
                        val color = jsonObject["color"]?.jsonPrimitive?.content ?: "#868e96"
                        val icon = jsonObject["icon"]?.jsonPrimitive?.content ?: "tag"
                        val type = jsonObject["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE"
                        
                        val category = Category(name = name, color = color, icon = icon, type = type)
                        db.categoryDao().insertCategory(category)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        ApiResponse(body = json.encodeToJsonElement(db.categoryDao().getAllCategories()))
                    }
                }
                path == "pay_methods" || path.startsWith("pay_methods/") -> {
                    if (method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val name = jsonObject["name"]?.jsonPrimitive?.content ?: ""
                        val type = jsonObject["type"]?.jsonPrimitive?.content ?: "CARD"
                        
                        val payMethod = PayMethod(name = name, type = type)
                        db.payMethodDao().insertPayMethod(payMethod)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        val payMethods = db.payMethodDao().getAllPayMethods()
                        val settings = db.settingsDao().getSettings()
                        val orderJson = settings?.pay_methods_order
                        val orderList = try {
                            orderJson?.let { json.decodeFromString<List<String>>(it) } ?: emptyList()
                        } catch (e: Exception) {
                            emptyList()
                        }
                        val sortedPayMethods = payMethods.sortedWith { pm1, pm2 ->
                            var idx1 = orderList.indexOf(pm1.name)
                            var idx2 = orderList.indexOf(pm2.name)
                            if (idx1 == -1) idx1 = 9999
                            if (idx2 == -1) idx2 = 9999
                            idx1.compareTo(idx2)
                        }
                        ApiResponse(body = json.encodeToJsonElement(sortedPayMethods))
                    }
                }
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
                                    db.runInTransaction {
                                        runBlocking {
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
                        val currentSettings = db.settingsDao().getSettings() ?: Settings()
                        
                        var monthlyBudget = currentSettings.monthlyBudget
                        if (bodyObj.containsKey("monthly_budget")) {
                            monthlyBudget = bodyObj["monthly_budget"]?.jsonPrimitive?.longOrNull ?: monthlyBudget
                        }
                        if (bodyObj.containsKey("monthlyBudget")) {
                            monthlyBudget = bodyObj["monthlyBudget"]?.jsonPrimitive?.longOrNull ?: monthlyBudget
                        }

                        var userRealName = currentSettings.userRealName
                        if (bodyObj.containsKey("user_real_name")) {
                            userRealName = bodyObj["user_real_name"]?.jsonPrimitive?.contentOrNull ?: userRealName
                        }

                        var autoRuleGeneration = currentSettings.autoRuleGeneration
                        if (bodyObj.containsKey("auto_rule_generation")) {
                            val value = bodyObj["auto_rule_generation"]
                            autoRuleGeneration = if (value is JsonPrimitive) {
                                if (value.isString) {
                                    value.content == "true"
                                } else {
                                    value.booleanOrNull ?: autoRuleGeneration
                                }
                            } else {
                                autoRuleGeneration
                            }
                        }

                        var initialBalance = currentSettings.initial_balance
                        if (bodyObj.containsKey("initial_balance")) {
                            initialBalance = bodyObj["initial_balance"]?.jsonPrimitive?.longOrNull ?: initialBalance
                        }

                        var initialBalances = currentSettings.initial_balances
                        if (bodyObj.containsKey("initial_balances")) {
                            val element = bodyObj["initial_balances"]
                            initialBalances = if (element is JsonObject) {
                                element.toString()
                            } else {
                                element?.jsonPrimitive?.contentOrNull ?: initialBalances
                            }
                        }

                        var initialPoints = currentSettings.initial_points
                        if (bodyObj.containsKey("initial_points")) {
                            val element = bodyObj["initial_points"]
                            initialPoints = if (element is JsonObject) {
                                element.toString()
                            } else {
                                element?.jsonPrimitive?.contentOrNull ?: initialPoints
                            }
                        }

                        var cardPerformanceDays = currentSettings.card_performance_days
                        if (bodyObj.containsKey("card_performance_days")) {
                            val element = bodyObj["card_performance_days"]
                            cardPerformanceDays = if (element is JsonObject) {
                                element.toString()
                            } else {
                                element?.jsonPrimitive?.contentOrNull ?: cardPerformanceDays
                            }
                        }

                        var cardPerformanceGoals = currentSettings.card_performance_goals
                        if (bodyObj.containsKey("card_performance_goals")) {
                            val element = bodyObj["card_performance_goals"]
                            cardPerformanceGoals = if (element is JsonObject) {
                                element.toString()
                            } else {
                                element?.jsonPrimitive?.contentOrNull ?: cardPerformanceGoals
                            }
                        }

                        var payMethodsOrder = currentSettings.pay_methods_order
                        if (bodyObj.containsKey("pay_methods_order")) {
                            val element = bodyObj["pay_methods_order"]
                            payMethodsOrder = if (element is JsonArray) {
                                element.toString()
                            } else {
                                element?.jsonPrimitive?.contentOrNull ?: payMethodsOrder
                            }
                        }

                        var aiEnabled = currentSettings.ai_enabled
                        if (bodyObj.containsKey("ai_enabled")) {
                            val value = bodyObj["ai_enabled"]
                            aiEnabled = if (value is JsonPrimitive) {
                                if (value.isString) value.content == "true" else value.booleanOrNull ?: aiEnabled
                            } else aiEnabled
                        }

                        var aiParsingEnabled = currentSettings.ai_parsing_enabled
                        if (bodyObj.containsKey("ai_parsing_enabled")) {
                            val value = bodyObj["ai_parsing_enabled"]
                            aiParsingEnabled = if (value is JsonPrimitive) {
                                if (value.isString) value.content == "true" else value.booleanOrNull ?: aiParsingEnabled
                            } else aiParsingEnabled
                        }

                        var aiProvider = currentSettings.ai_provider
                        if (bodyObj.containsKey("ai_provider")) {
                            aiProvider = bodyObj["ai_provider"]?.jsonPrimitive?.contentOrNull ?: aiProvider
                        }

                        var aiApiKey = currentSettings.ai_api_key
                        if (bodyObj.containsKey("ai_api_key")) {
                            aiApiKey = bodyObj["ai_api_key"]?.jsonPrimitive?.contentOrNull ?: aiApiKey
                        }

                        var aiLocalIp = currentSettings.ai_local_ip
                        if (bodyObj.containsKey("ai_local_ip")) {
                            aiLocalIp = bodyObj["ai_local_ip"]?.jsonPrimitive?.contentOrNull ?: aiLocalIp
                        }

                        var aiLocalModel = currentSettings.ai_local_model
                        if (bodyObj.containsKey("ai_local_model")) {
                            aiLocalModel = bodyObj["ai_local_model"]?.jsonPrimitive?.contentOrNull ?: aiLocalModel
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
                path.startsWith("transactions") -> {
                    if (method == "POST" && body != null) {
                        val bodyObj = json.parseToJsonElement(body).jsonObject
                        val idRaw = bodyObj["id"]?.jsonPrimitive?.contentOrNull
                        val idLong = idRaw?.toLongOrNull() ?: 0L
                        
                        val type = bodyObj["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE"
                        val amount = bodyObj["amount"]?.jsonPrimitive?.longOrNull ?: 0L
                        val merchant = bodyObj["merchant"]?.jsonPrimitive?.contentOrNull ?: ""
                        val category = bodyObj["category"]?.jsonPrimitive?.contentOrNull ?: ""
                        
                        val packageVal = bodyObj["package"]?.jsonPrimitive?.contentOrNull
                        var payMethod = bodyObj["pay_method"]?.jsonPrimitive?.contentOrNull ?: ""

                        // 패키지별 결제수단 자동 매핑 처리 (백엔드 routes/transactions.js 동기화)
                        if (!packageVal.isNullOrEmpty()) {
                            val mappedRow = db.packagePayMethodDao().getPackagePayMethodByPackage(packageVal)
                            if (mappedRow != null && mappedRow.pay_method.isNotEmpty()) {
                                payMethod = mappedRow.pay_method
                            }
                        }
                        if (payMethod == "_AUTO_MAPPING_") {
                            payMethod = "카드"
                        }

                        val tx = Transaction(
                            id = idLong,
                            type = type,
                            amount = amount,
                            merchant = merchant,
                            category = category,
                            payMethod = payMethod,
                            datetime = bodyObj["datetime"]?.jsonPrimitive?.contentOrNull ?: "",
                            memo = bodyObj["memo"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull ?: "",
                            rawText = bodyObj["raw_text"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.contentOrNull ?: "",
                            usedPoint = bodyObj["used_point"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.longOrNull ?: 0L
                        )
                        db.transactionDao().insertTransaction(tx)

                        // 사용처별 카테고리 자동 학습 기능 추가 (지출건 전용, 백엔드 동기화)
                        if (merchant.isNotEmpty() && category.isNotEmpty() && type == "EXPENSE") {
                            db.merchantCategoryDao().insertMerchantCategory(
                                MerchantCategory(merchant = merchant, category = category)
                            )
                        }

                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else if (method == "DELETE") {
                        val id = path.substringAfterLast("/").toLongOrNull()
                        if (id != null) {
                            db.openHelper.writableDatabase.execSQL("DELETE FROM transactions WHERE id = $id")
                        }
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        val month = queryParams["month"]
                        val category = queryParams["category"]
                        val search = queryParams["search"]
                        val payMethod = queryParams["pay_method"]
                        val typeVal = queryParams["type"]

                        var sql = "SELECT * FROM transactions WHERE 1=1"
                        val params = mutableListOf<String>()

                        if (month != null) {
                            var startDay = 1
                            if (payMethod != null) {
                                val settings = db.settingsDao().getSettings()
                                if (settings?.card_performance_days != null) {
                                    try {
                                        val cardPerformanceDays = json.parseToJsonElement(settings.card_performance_days).jsonObject
                                        startDay = cardPerformanceDays[payMethod]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 1
                                    } catch (e: Exception) {}
                                }
                            }

                            if (startDay > 1) {
                                val parts = month.split("-")
                                if (parts.size == 2) {
                                    val yearVal = parts[0].toIntOrNull() ?: 2026
                                    val monthVal = parts[1].toIntOrNull() ?: 1
                                    val startYear = if (monthVal == 1) yearVal - 1 else yearVal
                                    val startMonth = if (monthVal == 1) 12 else monthVal - 1
                                    val startStr = "${startYear}-${String.format("%02d", startMonth)}-${String.format("%02d", startDay)} 00:00:00"
                                    val endStr = "${yearVal}-${String.format("%02d", monthVal)}-${String.format("%02d", startDay - 1)} 23:59:59"
                                    sql += " AND datetime >= ? AND datetime <= ?"
                                    params.add(startStr)
                                    params.add(endStr)
                                } else {
                                    sql += " AND datetime LIKE ?"
                                    params.add("$month%")
                                }
                            } else {
                                sql += " AND datetime LIKE ?"
                                params.add("$month%")
                            }
                        }

                        if (category != null) {
                            sql += " AND category = ?"
                            params.add(category)
                        }

                        if (search != null) {
                            sql += " AND (merchant LIKE ? OR memo LIKE ? OR raw_text LIKE ?)"
                            val searchTerm = "%$search%"
                            params.add(searchTerm)
                            params.add(searchTerm)
                            params.add(searchTerm)
                        }

                        if (payMethod != null) {
                            sql += " AND pay_method = ?"
                            params.add(payMethod)
                        }

                        if (typeVal != null) {
                            sql += " AND type = ?"
                            params.add(typeVal)
                        }

                        sql += " ORDER BY datetime DESC, id DESC"
                        val resultList = queryRaw(db, sql, params.toTypedArray())
                        ApiResponse(body = resultList)
                    }
                }
                path.startsWith("rules") -> {
                    if (path == "rules/ai-generate" && method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val text = jsonObject["text"]?.jsonPrimitive?.content ?: ""
                        val settings = db.settingsDao().getSettings() ?: Settings()
                        val aiConfig = AIConfig(
                            provider = settings.ai_provider,
                            apiKey = settings.ai_api_key,
                            localIp = settings.ai_local_ip,
                            localModel = settings.ai_local_model
                        )
                        val patternVal = runBlocking {
                            NotificationParser.generatePatternWithAI(text, aiConfig)
                        }
                        if (patternVal != null) {
                            ApiResponse(body = buildJsonObject { 
                                put("success", JsonPrimitive(true))
                                put("pattern", JsonPrimitive(patternVal)) 
                            })
                        } else {
                            ApiResponse(body = buildJsonObject { 
                                put("success", JsonPrimitive(false))
                                put("message", JsonPrimitive("패턴 생성에 실패했습니다.")) 
                            })
                        }
                    } else if (method == "POST" && body != null) {
                        val jsonObject = json.parseToJsonElement(body).jsonObject
                        val id = jsonObject["id"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
                        val name = jsonObject["name"]?.jsonPrimitive?.content ?: ""
                        val pattern = jsonObject["pattern"]?.jsonPrimitive?.content ?: ""
                        val category = jsonObject["category"]?.jsonPrimitive?.content ?: ""
                        val payMethod = jsonObject["pay_method"]?.jsonPrimitive?.content ?: ""
                        val merchantTemplate = jsonObject["merchant_template"]?.jsonPrimitive?.content ?: "\${merchant}"
                        val type = jsonObject["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE"
                        
                        val rule = if (id > 0) {
                            Rule(id = id, name = name, pattern = pattern, category = category, payMethod = payMethod, merchantTemplate = merchantTemplate, type = type)
                        } else {
                            Rule(name = name, pattern = pattern, category = category, payMethod = payMethod, merchantTemplate = merchantTemplate, type = type)
                        }
                        db.ruleDao().insertRule(rule)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else if (method == "DELETE") {
                        val id = path.substringAfterLast("/").toIntOrNull()
                        if (id != null) {
                            db.ruleDao().deleteRuleById(id)
                        }
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        ApiResponse(body = json.encodeToJsonElement(db.ruleDao().getAllRules()))
                    }
                }
                path == "parse-test" && method == "POST" && body != null -> {
                    val jsonObject = json.parseToJsonElement(body).jsonObject
                    val text = jsonObject["text"]?.jsonPrimitive?.content ?: ""
                    val pattern = jsonObject["pattern"]?.jsonPrimitive?.content ?: ""
                    val category = jsonObject["category"]?.jsonPrimitive?.content ?: ""
                    val payMethod = jsonObject["pay_method"]?.jsonPrimitive?.content ?: ""
                    val type = jsonObject["type"]?.jsonPrimitive?.contentOrNull ?: "EXPENSE"
                    
                    val dummyRule = Rule(
                        id = 9999,
                        name = "임시 테스트 규칙",
                        pattern = pattern,
                        category = category,
                        payMethod = payMethod,
                        type = type
                    )
                    
                    val parsed = NotificationParser.parseNotification(
                        text = text,
                        rules = listOf(dummyRule),
                        db = db,
                        packageName = "com.spendlog.android.test"
                    )
                    
                    if (parsed != null) {
                        ApiResponse(body = buildJsonObject {
                            put("success", true)
                            put("result", buildJsonObject {
                                put("amount", parsed.amount)
                                put("used_point", parsed.usedPoint)
                                put("merchant", parsed.merchant)
                                put("datetime", parsed.datetime)
                                put("pay_method", parsed.payMethod)
                                put("category", parsed.category)
                                put("type", parsed.type)
                                put("memo", parsed.memo)
                            })
                        })
                    } else {
                        ApiResponse(body = buildJsonObject {
                            put("success", false)
                            put("message", "정규식 패턴이 본문과 매칭되지 않거나, 필수 그룹(?<amount>, (?<merchant> 등)이 누락되었습니다.")
                        })
                    }
                }
                path.startsWith("pass_rules") -> {
                    if (method == "POST" && body != null) {
                        val rule = json.decodeFromString<PassRule>(body)
                        db.passRuleDao().insertPassRule(rule)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else if (method == "DELETE") {
                        val id = path.substringAfterLast("/").toIntOrNull()
                        if (id != null) db.passRuleDao().deletePassRuleById(id)
                        MainActivity.refreshUI()
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        ApiResponse(body = json.encodeToJsonElement(db.passRuleDao().getAllPassRules()))
                    }
                }
                path.startsWith("notification_logs") -> {
                    val logs = db.notificationLogDao().getRecentLogs()
                    val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                    val jsonLogs = logs.map { log ->
                        buildJsonObject {
                            put("id", log.id)
                            put("sender", log.sender)
                            put("raw_text", log.rawText)
                            put("title", log.title)
                            put("text", log.text)
                            put("parsed_status", log.parsedStatus)
                            put("created_at", sdf.format(Date(log.timestamp)))
                        }
                    }
                    ApiResponse(body = JsonArray(jsonLogs))
                }
                path.startsWith("login") -> {
                    ApiResponse(body = buildJsonObject { 
                        put("success", true)
                    })
                }
                path.startsWith("permissions/notification") -> {
                    if (path.endsWith("request")) {
                        val intent = android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
                        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                        ApiResponse(body = buildJsonObject { put("success", true) })
                    } else {
                        val packageName = context.packageName
                        val flat = android.provider.Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
                        val isGranted = flat?.contains(packageName) == true
                        ApiResponse(body = buildJsonObject { put("granted", isGranted) })
                    }
                }
                path.startsWith("permissions/battery") -> {
                    if (path.endsWith("request")) {
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                            val intent = android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                data = android.net.Uri.parse("package:${context.packageName}")
                                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            try {
                                context.startActivity(intent)
                                ApiResponse(body = buildJsonObject { put("success", true) })
                            } catch (e: Exception) {
                                val fallbackIntent = android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                                }
                                context.startActivity(fallbackIntent)
                                ApiResponse(body = buildJsonObject { put("success", true); put("fallback", true) })
                            }
                        } else {
                            ApiResponse(body = buildJsonObject { put("success", true) })
                        }
                    } else {
                        val powerManager = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                        val isIgnoring = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                            powerManager.isIgnoringBatteryOptimizations(context.packageName)
                        } else {
                            true
                        }
                        ApiResponse(body = buildJsonObject { put("granted", isIgnoring) })
                    }
                }
                path.startsWith("permissions/post_notification") -> {
                    if (path.endsWith("request")) {
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                            val mainActivity = context as? MainActivity
                            mainActivity?.runOnUiThread {
                                androidx.core.app.ActivityCompat.requestPermissions(
                                    mainActivity,
                                    arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                                    1001
                                )
                            }
                            ApiResponse(body = buildJsonObject { put("success", true) })
                        } else {
                            ApiResponse(body = buildJsonObject { put("success", true) })
                        }
                    } else {
                        val isGranted = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                            androidx.core.content.ContextCompat.checkSelfPermission(
                                context,
                                android.Manifest.permission.POST_NOTIFICATIONS
                            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                        } else {
                            true
                        }
                        ApiResponse(body = buildJsonObject { put("granted", isGranted) })
                    }
                }
                path == "stats" -> {
                    val month = queryParams["month"] ?: SimpleDateFormat("yyyy-MM", Locale.US).format(Date())
                    
                    val totalRow = queryRawSingle(db,
                        "SELECT SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
                        "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
                        "FROM transactions WHERE datetime LIKE ?", arrayOf("$month%")
                    )
                    val totalExpense = totalRow?.get("expense")?.jsonPrimitive?.longOrNull ?: 0L
                    val totalIncome = totalRow?.get("income")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val categoryRows = queryRaw(db,
                        "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' GROUP BY category ORDER BY total DESC",
                        arrayOf("$month%")
                    )
                    
                    val dailyRows = queryRaw(db,
                        "SELECT substr(datetime, 1, 10) as date, " +
                        "SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
                        "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
                        "FROM transactions WHERE datetime LIKE ? GROUP BY date ORDER BY date ASC",
                        arrayOf("$month%")
                    )
                    
                    val settingsObj = db.settingsDao().getSettings() ?: Settings()
                    val budget = settingsObj.monthlyBudget
                    
                    val trendArray = buildJsonArray {
                        val sdf = SimpleDateFormat("yyyy-MM", Locale.US)
                        val cal = Calendar.getInstance()
                        val parts = month.split("-")
                        if (parts.size == 2) {
                            cal.set(Calendar.YEAR, parts[0].toIntOrNull() ?: cal.get(Calendar.YEAR))
                            cal.set(Calendar.MONTH, (parts[1].toIntOrNull() ?: 1) - 1)
                        }
                        cal.set(Calendar.DAY_OF_MONTH, 1)
                        
                        val targetMonths = mutableListOf<String>()
                        for (i in 5 downTo 0) {
                            val tempCal = cal.clone() as Calendar
                            tempCal.add(Calendar.MONTH, -i)
                            targetMonths.add(sdf.format(tempCal.time))
                        }
                        
                        for (targetMonth in targetMonths) {
                            val r = queryRawSingle(db,
                                "SELECT SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
                                "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
                                "FROM transactions WHERE datetime LIKE ?", arrayOf("$targetMonth%")
                            )
                            add(buildJsonObject {
                                put("month", targetMonth)
                                put("expense", r?.get("expense")?.jsonPrimitive?.longOrNull ?: 0L)
                                put("income", r?.get("income")?.jsonPrimitive?.longOrNull ?: 0L)
                            })
                        }
                    }
                    
                    val payMethods = db.payMethodDao().getAllPayMethods()
                    val orderJson = settingsObj.pay_methods_order
                    val orderList = try {
                        orderJson?.let { json.decodeFromString<List<String>>(it) } ?: emptyList()
                    } catch (e: Exception) {
                        emptyList()
                    }
                    val sortedPayMethods = payMethods.sortedWith { pm1, pm2 ->
                        var idx1 = orderList.indexOf(pm1.name)
                        var idx2 = orderList.indexOf(pm2.name)
                        if (idx1 == -1) idx1 = 9999
                        if (idx2 == -1) idx2 = 9999
                        idx1.compareTo(idx2)
                    }
                    
                    val initialBalances = try {
                        settingsObj.initial_balances?.let { json.parseToJsonElement(it).jsonObject } ?: buildJsonObject {}
                    } catch (e: Exception) {
                        buildJsonObject {}
                    }
                    val initialPoints = try {
                        settingsObj.initial_points?.let { json.parseToJsonElement(it).jsonObject } ?: buildJsonObject {}
                    } catch (e: Exception) {
                        buildJsonObject {}
                    }
                    val cardPerformanceDays = try {
                        settingsObj.card_performance_days?.let { json.parseToJsonElement(it).jsonObject } ?: buildJsonObject {}
                    } catch (e: Exception) {
                        buildJsonObject {}
                    }
                    
                    val allTimeRows = queryRaw(db,
                        "SELECT pay_method, " +
                        "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as total_income, " +
                        "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as total_expense, " +
                        "SUM(COALESCE(used_point, 0)) as total_used_point " +
                        "FROM transactions GROUP BY pay_method"
                    )
                    val allTimeMap = allTimeRows.associateBy { it.jsonObject["pay_method"]?.jsonPrimitive?.contentOrNull ?: "" }
                    
                    val monthRows = queryRaw(db,
                        "SELECT pay_method, " +
                        "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
                        "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
                        "FROM transactions WHERE datetime LIKE ? GROUP BY pay_method", arrayOf("$month%")
                    )
                    val monthMap = monthRows.associateBy { it.jsonObject["pay_method"]?.jsonPrimitive?.contentOrNull ?: "" }.toMutableMap()
                    
                    val partsM = month.split("-")
                    if (partsM.size == 2) {
                        val yearVal = partsM[0].toIntOrNull() ?: 2026
                        val monthVal = partsM[1].toIntOrNull() ?: 6
                        for (pm in sortedPayMethods) {
                            val name = pm.name
                            val startDay = cardPerformanceDays[name]?.jsonPrimitive?.intOrNull ?: 1
                            if (startDay > 1) {
                                val startYear = if (monthVal == 1) yearVal - 1 else yearVal
                                val startMonth = if (monthVal == 1) 12 else monthVal - 1
                                val startStr = String.format("%d-%02d-%02d 00:00:00", startYear, startMonth, startDay)
                                val endStr = String.format("%d-%02d-%02d 23:59:59", yearVal, monthVal, startDay - 1)
                                
                                val customRow = queryRawSingle(db,
                                    "SELECT SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
                                    "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
                                    "FROM transactions WHERE pay_method = ? AND datetime >= ? AND datetime <= ?",
                                    arrayOf(name, startStr, endStr)
                                )
                                
                                    monthMap[name] = buildJsonObject {
                                    put("pay_method", name)
                                    put("month_income", customRow?.get("month_income")?.jsonPrimitive?.longOrNull ?: 0L)
                                    put("month_expense", customRow?.get("month_expense")?.jsonPrimitive?.longOrNull ?: 0L)
                                }
                            }
                        }
                    }
                    
                    val assetsArray = buildJsonArray {
                        for (pm in sortedPayMethods) {
                            val name = pm.name
                            if (name == "계좌이체" || name == "신용카드" || name == "체크카드") continue
                            
                            val isCard = pm.type == "CARD" || name.contains("카드") || name.contains("페이") || name.contains("머니")
                            
                            val initBal = initialBalances[name]?.jsonPrimitive?.longOrNull ?: 0L
                            val initPt = initialPoints[name]?.jsonPrimitive?.longOrNull ?: 0L
                            
                            val allTime = allTimeMap[name]?.jsonObject
                            val totalIncome = allTime?.get("total_income")?.jsonPrimitive?.longOrNull ?: 0L
                            val totalExpense = allTime?.get("total_expense")?.jsonPrimitive?.longOrNull ?: 0L
                            val totalUsedPt = allTime?.get("total_used_point")?.jsonPrimitive?.longOrNull ?: 0L
                            
                            val mTime = monthMap[name]?.jsonObject
                            val mIncome = mTime?.get("month_income")?.jsonPrimitive?.longOrNull ?: 0L
                            val mExpense = mTime?.get("month_expense")?.jsonPrimitive?.longOrNull ?: 0L
                            
                            val effectivePoint = maxOf(totalUsedPt, initPt)
                            val adjustedExpense = maxOf(0L, totalExpense - totalUsedPt)
                            val currentBalance = initBal + totalIncome - adjustedExpense
                            val remainingPoint = if (effectivePoint > 0) maxOf(0L, effectivePoint - totalUsedPt) else 0L
                            
                            add(buildJsonObject {
                                put("name", name)
                                put("isCard", isCard)
                                put("initialBalance", initBal)
                                put("currentBalance", currentBalance)
                                put("monthIncome", mIncome)
                                put("monthExpense", mExpense)
                                put("initialPoint", effectivePoint)
                                put("remainingPoint", remainingPoint)
                            })
                        }
                    }
                    
                    ApiResponse(body = buildJsonObject {
                        put("totalExpense", totalExpense)
                        put("totalIncome", totalIncome)
                        put("budget", budget)
                        put("categories", categoryRows)
                        put("daily", dailyRows)
                        put("trend", trendArray)
                        put("assets", assetsArray)
                    })
                }
                path == "analytics/monthly" -> {
                    val rows = queryRaw(db, """
                        SELECT 
                          strftime('%Y-%m', datetime) as month,
                          SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
                          SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
                        FROM transactions
                        WHERE datetime IS NOT NULL AND datetime != ''
                        GROUP BY month
                        ORDER BY month DESC
                        LIMIT 12
                    """.trimIndent())
                    ApiResponse(body = JsonArray(rows.reversed()))
                }
                path == "analytics/monthly-detail" -> {
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val monthVal = queryParams["month"] ?: "1"
                    val targetMonth = String.format("%s-%02d", year, monthVal.toIntOrNull() ?: 1)
                    
                    val dailyRows = queryRaw(db, """
                        SELECT 
                          strftime('%d', datetime) as day,
                          SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
                          SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
                        FROM transactions
                        WHERE datetime LIKE ?
                        GROUP BY day
                        ORDER BY day ASC
                    """.trimIndent(), arrayOf("$targetMonth%"))
                    
                    val categoryRows = queryRaw(db, """
                        SELECT 
                          category,
                          SUM(amount) as total
                        FROM transactions
                        WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category != '이체/입금'
                        GROUP BY category
                        ORDER BY total DESC
                    """.trimIndent(), arrayOf("$targetMonth%"))
                    
                    ApiResponse(body = buildJsonObject {
                        put("daily", dailyRows)
                        put("categories", categoryRows)
                    })
                }
                path == "analytics/yearly" -> {
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val prevYear = (year.toIntOrNull() ?: 2026).let { it - 1 }.toString()
                    
                    val monthlyRows = queryRaw(db, """
                        SELECT 
                          strftime('%m', datetime) as month,
                          SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
                          SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
                        FROM transactions
                        WHERE datetime LIKE ?
                        GROUP BY month
                        ORDER BY month ASC
                    """.trimIndent(), arrayOf("$year%"))
                    
                    val categoryCompare = queryRaw(db, """
                        SELECT 
                          c.name as category,
                          COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_year_total,
                          COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_year_total
                        FROM categories c
                        LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
                        WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
                        GROUP BY c.name
                        ORDER BY current_year_total DESC
                    """.trimIndent(), arrayOf(year, prevYear, "$year%", "$prevYear%"))
                    
                    ApiResponse(body = buildJsonObject {
                        put("monthly", monthlyRows)
                        put("categories", categoryCompare)
                    })
                }
                path == "analytics/compare" -> {
                    val mode = queryParams["mode"] ?: "yoy"
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val monthVal = queryParams["month"] ?: "1"
                    
                    if (mode == "mom") {
                        val curMonthInt = monthVal.toIntOrNull() ?: 1
                        val currentMonth = String.format("%s-%02d", year, curMonthInt)
                        
                        val cal = Calendar.getInstance()
                        val currentYearInt = year.toIntOrNull() ?: 2026
                        cal.set(Calendar.YEAR, currentYearInt)
                        cal.set(Calendar.MONTH, curMonthInt - 1 - 1)
                        val prevYear = cal.get(Calendar.YEAR).toString()
                        val prevMonthVal = cal.get(Calendar.MONTH) + 1
                        val prevMonth = String.format("%s-%02d", prevYear, prevMonthVal)
                        
                        val categoryCompare = queryRaw(db, """
                            SELECT 
                              c.name as category,
                              COALESCE(SUM(CASE WHEN strftime('%Y-%m', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_total,
                              COALESCE(SUM(CASE WHEN strftime('%Y-%m', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_total
                            FROM categories c
                            LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
                            WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
                            GROUP BY c.name
                            ORDER BY current_total DESC
                        """.trimIndent(), arrayOf(currentMonth, prevMonth, "$currentMonth%", "$prevMonth%"))
                        
                        ApiResponse(body = buildJsonObject {
                            put("compare", categoryCompare)
                            put("current_label", "${curMonthInt}월")
                            put("prev_label", "${prevMonthVal}월")
                        })
                    } else {
                        val prevYear = (year.toIntOrNull() ?: 2026).let { it - 1 }.toString()
                        val categoryCompare = queryRaw(db, """
                            SELECT 
                              c.name as category,
                              COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_total,
                              COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_total
                            FROM categories c
                            LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
                            WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
                            GROUP BY c.name
                            ORDER BY current_total DESC
                        """.trimIndent(), arrayOf(year, prevYear, "$year%", "$prevYear%"))
                        
                        ApiResponse(body = buildJsonObject {
                            put("compare", categoryCompare)
                            put("current_label", "올해 누적")
                            put("prev_label", "전년도 누적")
                        })
                    }
                }
                path == "analytics/fixed" -> {
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val monthVal = queryParams["month"] ?: "all"
                    val isYearly = monthVal == "all"
                    val targetPattern = if (isYearly) "$year%" else String.format("%s-%02d%%", year, monthVal.toIntOrNull() ?: 1)
                    
                    val fixedCategories = listOf("구독", "보험", "수도광열비", "주거", "통신비", "대출상환")
                    val placeholders = fixedCategories.map { "?" }.joinToString(",")
                    
                    val totalSpentRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                        arrayOf(targetPattern)
                    )
                    val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val fixedTotalRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders)",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    val fixedTotal = fixedTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val categoryRows = queryRaw(db,
                        "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders) GROUP BY category ORDER BY total DESC",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    
                    val transactionRows = queryRaw(db,
                        "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders) ORDER BY datetime DESC",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    
                    val trendArray = buildJsonArray {
                        if (isYearly) {
                            // 오타 수정: type = 'EXPES' -> type = 'EXPENSE' (의존성: analytics.js 쿼리 구조와 동일하게 매핑)
                            val trendRows = queryRaw(db,
                                "SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders) GROUP BY month ORDER BY month ASC",
                                arrayOf(targetPattern, *fixedCategories.toTypedArray())
                            )
                            val trendMap = trendRows.associateBy { it.jsonObject["month"]?.jsonPrimitive?.contentOrNull ?: "" }
                            for (m in 1..12) {
                                val monthKey = String.format("%s-%02d", year, m)
                                val targetRow = trendMap[monthKey]?.jsonObject
                                add(buildJsonObject {
                                    put("month", monthKey)
                                    put("total", targetRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        } else {
                            val curMonthInt = monthVal.toIntOrNull() ?: 1
                            val cal = Calendar.getInstance()
                            val curYearInt = year.toIntOrNull() ?: 2026
                            cal.set(Calendar.YEAR, curYearInt)
                            cal.set(Calendar.MONTH, curMonthInt - 1)
                            cal.set(Calendar.DAY_OF_MONTH, 1)
                            
                            val targetMonths = mutableListOf<String>()
                            for (i in 5 downTo 0) {
                                val tempCal = cal.clone() as Calendar
                                tempCal.add(Calendar.MONTH, -i)
                                targetMonths.add(SimpleDateFormat("yyyy-MM", Locale.US).format(tempCal.time))
                            }
                            
                            for (targetM in targetMonths) {
                                val trendRow = queryRawSingle(db,
                                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders)",
                                    arrayOf("$targetM%", *fixedCategories.toTypedArray())
                                )
                                add(buildJsonObject {
                                    put("month", targetM)
                                    put("total", trendRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        }
                    }
                    
                    ApiResponse(body = buildJsonObject {
                        put("totalSpent", totalSpent)
                        put("fixedTotal", fixedTotal)
                        put("categories", categoryRows)
                        put("transactions", transactionRows)
                        put("trend", trendArray)
                    })
                }
                path == "analytics/general" -> {
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val monthVal = queryParams["month"] ?: "all"
                    val isYearly = monthVal == "all"
                    val targetPattern = if (isYearly) "$year%" else String.format("%s-%02d%%", year, monthVal.toIntOrNull() ?: 1)
                    
                    val fixedCategories = listOf("구독", "보험", "수도광열비", "주거", "통신비", "대출상환")
                    val placeholders = fixedCategories.map { "?" }.joinToString(",")
                    
                    val totalSpentRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                        arrayOf(targetPattern)
                    )
                    val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val generalTotalRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders)",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    val generalTotal = generalTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val categoryRows = queryRaw(db,
                        "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders) GROUP BY category ORDER BY total DESC",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    
                    val transactionRows = queryRaw(db,
                        "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders) ORDER BY datetime DESC",
                        arrayOf(targetPattern, *fixedCategories.toTypedArray())
                    )
                    
                    val trendArray = buildJsonArray {
                        if (isYearly) {
                            val trendRows = queryRaw(db,
                                "SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders) GROUP BY month ORDER BY month ASC",
                                arrayOf(targetPattern, *fixedCategories.toTypedArray())
                            )
                            val trendMap = trendRows.associateBy { it.jsonObject["month"]?.jsonPrimitive?.contentOrNull ?: "" }
                            for (m in 1..12) {
                                val monthKey = String.format("%s-%02d", year, m)
                                val targetRow = trendMap[monthKey]?.jsonObject
                                add(buildJsonObject {
                                    put("month", monthKey)
                                    put("total", targetRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        } else {
                            val curMonthInt = monthVal.toIntOrNull() ?: 1
                            val cal = Calendar.getInstance()
                            val curYearInt = year.toIntOrNull() ?: 2026
                            cal.set(Calendar.YEAR, curYearInt)
                            cal.set(Calendar.MONTH, curMonthInt - 1)
                            cal.set(Calendar.DAY_OF_MONTH, 1)
                            
                            val targetMonths = mutableListOf<String>()
                            for (i in 5 downTo 0) {
                                val tempCal = cal.clone() as Calendar
                                tempCal.add(Calendar.MONTH, -i)
                                targetMonths.add(SimpleDateFormat("yyyy-MM", Locale.US).format(tempCal.time))
                            }
                            
                            for (targetM in targetMonths) {
                                val trendRow = queryRawSingle(db,
                                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders)",
                                    arrayOf("$targetM%", *fixedCategories.toTypedArray())
                                )
                                add(buildJsonObject {
                                    put("month", targetM)
                                    put("total", trendRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        }
                    }
                    
                    ApiResponse(body = buildJsonObject {
                        put("totalSpent", totalSpent)
                        put("generalTotal", generalTotal)
                        put("categories", categoryRows)
                        put("transactions", transactionRows)
                        put("trend", trendArray)
                    })
                }
                path == "analytics/income" -> {
                    val year = queryParams["year"] ?: SimpleDateFormat("yyyy", Locale.US).format(Date())
                    val monthVal = queryParams["month"] ?: "all"
                    val isYearly = monthVal == "all"
                    val targetPattern = if (isYearly) "$year%" else String.format("%s-%02d%%", year, monthVal.toIntOrNull() ?: 1)
                    
                    val incomeTotalRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
                        arrayOf(targetPattern)
                    )
                    val incomeTotal = incomeTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val totalSpentRow = queryRawSingle(db,
                        "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                        arrayOf(targetPattern)
                    )
                    val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val categoryRows = queryRaw(db,
                        "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' GROUP BY category ORDER BY total DESC",
                        arrayOf(targetPattern)
                    )
                    
                    val transactionRows = queryRaw(db,
                        "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' ORDER BY datetime DESC",
                        arrayOf(targetPattern)
                    )
                    
                    val trendArray = buildJsonArray {
                        if (isYearly) {
                            val trendRows = queryRaw(db,
                                "SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' GROUP BY month ORDER BY month ASC",
                                arrayOf(targetPattern)
                            )
                            val trendMap = trendRows.associateBy { it.jsonObject["month"]?.jsonPrimitive?.contentOrNull ?: "" }
                            for (m in 1..12) {
                                val monthKey = String.format("%s-%02d", year, m)
                                val targetRow = trendMap[monthKey]?.jsonObject
                                add(buildJsonObject {
                                    put("month", monthKey)
                                    put("total", targetRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        } else {
                            val curMonthInt = monthVal.toIntOrNull() ?: 1
                            val cal = Calendar.getInstance()
                            val curYearInt = year.toIntOrNull() ?: 2026
                            cal.set(Calendar.YEAR, curYearInt)
                            cal.set(Calendar.MONTH, curMonthInt - 1)
                            cal.set(Calendar.DAY_OF_MONTH, 1)
                            
                            val targetMonths = mutableListOf<String>()
                            for (i in 5 downTo 0) {
                                val tempCal = cal.clone() as Calendar
                                tempCal.add(Calendar.MONTH, -i)
                                targetMonths.add(SimpleDateFormat("yyyy-MM", Locale.US).format(tempCal.time))
                            }
                            
                            for (targetM in targetMonths) {
                                val trendRow = queryRawSingle(db,
                                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
                                    arrayOf("$targetM%")
                                )
                                add(buildJsonObject {
                                    put("month", targetM)
                                    put("total", trendRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L)
                                })
                            }
                        }
                    }
                    
                    ApiResponse(body = buildJsonObject {
                        put("incomeTotal", incomeTotal)
                        put("totalSpent", totalSpent)
                        put("categories", categoryRows)
                        put("transactions", transactionRows)
                        put("trend", trendArray)
                    })
                }
                path == "analytics/ai-report" -> {
                    ApiResponse(body = buildJsonObject {
                        put("success", false)
                        put("message", "모바일 앱 가계부에서는 AI 리포트 조회를 지원하지 않습니다.")
                    })
                }
                path == "analytics/ai-report/generate" -> {
                    ApiResponse(body = buildJsonObject {
                        put("success", false)
                        put("error", "모바일 앱 가계부에서는 AI 리포트 생성을 지원하지 않습니다.")
                    })
                }
                else -> ApiResponse(status = 404, body = buildJsonObject { put("error", "Not Found") })
            }
        } catch (e: Exception) {
            android.util.Log.e("SpendLogAPI", "API handling failed: ${e.message}", e)
            e.printStackTrace()
            return ApiResponse(status = 500, body = buildJsonObject { put("error", e.message ?: "Unknown error") })
        }
    }
}
