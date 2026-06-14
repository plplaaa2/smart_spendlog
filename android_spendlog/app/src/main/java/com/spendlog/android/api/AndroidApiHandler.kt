package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file AndroidApiHandler.kt
 * @summary WebView에서 요청되는 RESTful 모방 API 통신 처리기 (경량화된 라우팅 엔진)
 * @description WebView 네이티브 브릿지에서 전달된 HTTP Method 및 Endpoint 경로를 해석하여
 *              각 기능별 서브 핸들러(Transaction, Settings, Permission, Analytics, Rule)로 라우팅을 분기합니다.
 * @dependencies
 *   - TransactionApiHandler.kt (거래 내역 처리 위임)
 *   - SettingsApiHandler.kt (설정 및 백업/복원 처리 위임)
 *   - PermissionApiHandler.kt (권한 상태 제어 위임)
 *   - AnalyticsApiHandler.kt (자산/통계 분석 처리 위임)
 *   - RuleApiHandler.kt (정규식 분류/제외 규칙 처리 위임)
 *   - MainActivity.kt (UI 갱신 콜백 사용)
 */
object AndroidApiHandler {

    internal val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    internal fun queryRaw(db: SpendLogDatabase, sql: String, args: Array<out Any?>? = null): JsonArray {
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

    internal fun queryRawSingle(db: SpendLogDatabase, sql: String, args: Array<out Any?>? = null): JsonObject? {
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
                // 1. Transactions 위임
                path.startsWith("transactions") -> {
                    TransactionApiHandler.handleTransactionRequest(context, db, path, method, body, queryParams)
                }

                // 2. Settings 위임
                path == "settings/backup" || path == "settings/restore" || path.startsWith("settings") -> {
                    SettingsApiHandler.handleSettingsRequest(context, db, path, method, body)
                }

                // 3. Permissions 위임
                path.startsWith("permissions/") -> {
                    PermissionApiHandler.handlePermissionRequest(context, path)
                }

                // 4. Analytics 위임
                path == "stats" || path.startsWith("analytics/") -> {
                    AnalyticsApiHandler.handleAnalyticsRequest(context, db, path, method, body, queryParams)
                }

                // 5. Rules 위임
                path.startsWith("rules") || path == "parse-test" || path.startsWith("pass_rules") -> {
                    RuleApiHandler.handleRuleRequest(context, db, path, method, body)
                }

                // 6. 단순 메타데이터 및 인증/로그 CRUD 직접 처리
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
                path.startsWith("notification_logs") -> {
                    if (method == "POST" && path.endsWith("/retry")) {
                        val segments = path.split("/")
                        val logId = segments.getOrNull(1)?.toLongOrNull()
                        if (logId == null) {
                            ApiResponse(status = 400, body = buildJsonObject { put("error", "잘못된 로그 ID입니다.") })
                        } else {
                            val log = db.notificationLogDao().getLogById(logId)
                            if (log == null) {
                                ApiResponse(status = 404, body = buildJsonObject { put("error", "해당 알림 로그를 찾을 수 없습니다.") })
                            } else {
                                db.transactionDao().deleteTransactionsByRawText(log.rawText)
                                val rules = db.ruleDao().getAllRules()
                                
                                val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                                sdf.timeZone = TimeZone.getTimeZone("Asia/Seoul")
                                val logKSTTime = sdf.format(Date(log.timestamp))
                                
                                var result = com.spendlog.android.parser.NotificationParser.parseNotification(
                                    text = log.rawText,
                                    rules = rules,
                                    db = db,
                                    packageName = log.sender
                                )
                                
                                if (result == null && log.text.isNotEmpty()) {
                                    result = com.spendlog.android.parser.NotificationParser.parseNotification(
                                        text = log.text,
                                        rules = rules,
                                        db = db,
                                        packageName = log.sender
                                    )
                                }
                                
                                if (result != null) {
                                    val transaction = Transaction(
                                        type = result.type,
                                        amount = result.amount,
                                        merchant = result.merchant,
                                        category = result.category,
                                        payMethod = result.payMethod,
                                        payType = result.payType,
                                        datetime = result.datetime,
                                        memo = result.memo,
                                        rawText = log.rawText,
                                        usedPoint = result.usedPoint
                                    )
                                    db.transactionDao().insertTransaction(transaction)
                                    
                                    val updatedLog = log.copy(
                                        parsedStatus = "SUCCESS",
                                        matchedRuleId = result.ruleId
                                    )
                                    db.notificationLogDao().updateLog(updatedLog)
                                    MainActivity.refreshUI()
                                    
                                    ApiResponse(body = buildJsonObject {
                                        put("success", true)
                                        put("message", "알림 재시도 및 가계부 등록 완료")
                                        put("transaction", buildJsonObject {
                                            put("merchant", result.merchant)
                                            put("amount", result.amount)
                                        })
                                    })
                                } else {
                                    ApiResponse(status = 400, body = buildJsonObject {
                                        put("success", false)
                                        put("error", "여전히 알림을 분석할 수 있는 매칭 규칙이 없습니다.")
                                    })
                                }
                            }
                        }
                    } else {
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
                }
                path.startsWith("login") -> {
                    ApiResponse(body = buildJsonObject { 
                        put("success", true)
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
