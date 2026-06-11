package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import com.spendlog.android.parser.AIConfig
import com.spendlog.android.parser.NotificationParser
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file RuleApiHandler.kt
 * @summary 문자 자동분류 및 패스/제외 규칙 API 요청 처리 모듈
 * @description 문자 파싱 정규식(Rule) CRUD, AI 기반의 자동 정규식 패턴 생성,
 *              정규식 검증용 파싱 테스트(parse-test), 그리고 무시할 문자 키워드 패스 규칙(PassRule) 관리를 담당합니다.
 * @dependencies
 *   - AndroidApiHandler.kt (공통 DB 헬퍼 및 JSON 직렬화기 사용)
 *   - NotificationParser.kt / AIConfig.kt (문자 메시지 파싱 및 AI 모델 매핑 모듈)
 *   - Entities.kt / Daos.kt (Room DB 엔티티 및 DAO 인터페이스)
 */
object RuleApiHandler {

    suspend fun handleRuleRequest(
        context: Context,
        db: SpendLogDatabase,
        path: String,
        method: String,
        body: String?
    ): ApiResponse {
        val json = AndroidApiHandler.json

        return when {
            path.startsWith("rules/ai/generate") && method == "POST" && body != null -> {
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
            }
            path.startsWith("rules") -> {
                if (method == "POST" && body != null) {
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
            else -> ApiResponse(status = 404, body = buildJsonObject { put("error", "Not Found") })
        }
    }
}
