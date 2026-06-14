package com.spendlog.android.parser

import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonArray

data class AIConfig(
    val provider: String,
    val apiKey: String,
    val localIp: String,
    val localModel: String
)

/**
 * [AiParser.kt]
 * - 요약: Google Gemini, OpenAI, 또는 로컬 LLM을 연동하여 정규식 분류에 실패한 알림 메시지를 자율적으로 폴백 파싱하고, 규칙이 매칭되지 않는 텍스트에 대한 맞춤형 정규식 패턴을 생성해주는 모듈입니다.
 * - 연결된 파일 목록:
 *   - NotificationParser.kt (파싱 실패 시 AI 폴백 파싱 및 AI 추천 규칙 생성 통신 시 호출)
 */
object AiParser {

    private val aiJson = Json { ignoreUnknownKeys = true }

    /**
     * AI 모델을 통한 알림 원문 파싱 시도 (JSON 결과 반환)
     */
    suspend fun parseNotificationWithAI(
        text: String,
        config: AIConfig,
        fallbackDatetime: String? = null
    ): ParsedResult? {
        if (text.isEmpty()) return null

        val now = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"))
        val pad = { n: Int -> String.format("%02d", n) }
        val resolvedFallback = fallbackDatetime ?: buildString {
            append(now.get(Calendar.YEAR))
            append("-")
            append(pad(now.get(Calendar.MONTH) + 1))
            append("-")
            append(pad(now.get(Calendar.DAY_OF_MONTH)))
            append(" ")
            append(pad(now.get(Calendar.HOUR_OF_DAY)))
            append(":")
            append(pad(now.get(Calendar.MINUTE)))
            append(":")
            append(pad(now.get(Calendar.SECOND)))
        }

        val prompt = """
You are a financial transaction SMS/notification parser.
Analyze the following notification text and extract transaction details.
You MUST output the result ONLY as a JSON object, without markdown formatting or code blocks.
The JSON object MUST contain the following fields:
- "amount" (integer): The transaction amount.
- "merchant" (string): The merchant, sender, or receiver name. Keep it clean.
- "datetime" (string): Format: "YYYY-MM-DD HH:mm:ss". Use the transaction time from the text. If the year is not mentioned, use the current year from fallback date: $resolvedFallback. If no date/time is mentioned, use fallback date: $resolvedFallback.
- "pay_method" (string): The payment method name.
- "type" (string): "EXPENSE" for spending/outflow, "INCOME" for deposit/inflow.

Notification Text: "$text"
Fallback Date: "$resolvedFallback"
""".trimIndent()

        val responseText = callAiText(config, prompt) ?: return null
        val payload = normalizeJsonText(responseText) ?: return null
        val result = try {
            aiJson.parseToJsonElement(payload).jsonObject
        } catch (_: Exception) {
            return null
        }

        val amount = result["amount"]?.jsonPrimitive?.contentOrNull?.replace(",", "")?.toLongOrNull() ?: return null
        val merchant = result["merchant"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() } ?: "알수없음"
        val datetime = result["datetime"]?.jsonPrimitive?.contentOrNull?.takeUnless { it.isNullOrBlank() } ?: resolvedFallback
        val payMethod = result["pay_method"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() } ?: "카드"
        val type = if (result["type"]?.jsonPrimitive?.contentOrNull == "INCOME") "INCOME" else "EXPENSE"

        return ParsedResult(
            amount = amount,
            merchant = merchant,
            datetime = datetime,
            payMethod = payMethod,
            payType = "CREDIT",
            category = "_AUTO_MAPPING_",
            type = type,
            ruleId = null,
            ruleName = null,
            usedPoint = 0L,
            memo = ""
        )
    }

    /**
     * AI 모델을 통해 알림 원문에 대응되는 정규식 패턴 생성 추천
     */
    suspend fun generatePatternWithAI(text: String, config: AIConfig): String? {
        if (text.isEmpty()) return null

        val prompt = """
You are a regex pattern builder.
Build a JavaScript Regular Expression (RegExp) pattern that parses the following financial SMS/push notification text.
The regex pattern MUST extract the following values using NAMED CAPTURE GROUPS:
- "amount" (e.g. (?<amount>[\\d,]+) or similar): Extracts the transaction amount (REQUIRED).
- "merchant" (e.g. (?<merchant>.+?)): Extracts the merchant or sender.
- "time" (e.g. (?<time>\\d{2}/\\d{2}\\s+\\d{2}:\\d{2}) or similar): Extracts the date/time (optional but recommended if present).
- "account" (e.g. (?<account>[\\d*-]+)): Extracts the account number (optional).
- "balance" (e.g. (?<balance>[\\d,]+)): Extracts the remaining balance (optional).
- "cumulative" (e.g. (?<cumulative>[\\d,]+)): Extracts the cumulative monthly spending (optional).
- "usedPoint" (e.g. (?<usedPoint>[\\d,]+)): Extracts points/credits used (optional).
- "payMethod" (e.g. (?<payMethod>[^\\s/]+)): Extracts payment method/source such as bank or card brand name (optional).
- "payType" (e.g. (?<payType>[^\\s/]+)): Extracts payment type such as credit, checking, transfer, or cash (optional).

CRITICAL RULE FOR NEWLINES/SPACES:
DO NOT use raw newlines (\\n or \\r\\n) in the pattern. Instead, use \\s+ or \\s* to match line breaks and whitespaces to make the pattern platform-independent.

The pattern MUST match the entire text or its major part. Escape bracket characters properly.

Notification Text: "$text"

You MUST output the result ONLY as a JSON object, without markdown formatting or code blocks.
The JSON object MUST contain exactly one field:
- "pattern" (string): The constructed RegExp pattern.
""".trimIndent()

        val responseText = callAiText(config, prompt) ?: return null
        val payload = normalizeJsonText(responseText) ?: return null
        val result = try {
            aiJson.parseToJsonElement(payload).jsonObject
        } catch (_: Exception) {
            return null
        }

        return result["pattern"]?.jsonPrimitive?.contentOrNull?.takeUnless { it.isNullOrBlank() }
    }

    /**
     * AI 모델을 사용하여 소비 리포트 생성 (한 줄 요약 & 마크다운 본문 반환)
     */
    suspend fun generateConsumptionReportWithAI(dataText: String, config: AIConfig): Pair<String, String>? {
        if (dataText.isEmpty()) return null

        val prompt = """
당신은 대한민국 최고의 금융 분석가이자 개인 자산 관리 코치입니다.
사용자의 가계부 통계 데이터를 심층적으로 분석하여, 현재 소비 성향을 진단하고 실용적이고 구체적인 재정 피드백 리포트를 마크다운(Markdown) 형식으로 생성해 주세요.

[분석 대상 통계 데이터]
$dataText

[작성 및 출력 규칙]
1. 반드시 한국어로 정중하게 작성해 주십시오. (존댓말 사용)
2. 출력은 반드시 다음과 같은 JSON 객체 하나만 반환해야 하며, 마크다운 코드 블록이나 기타 텍스트 설명은 절대로 덧붙이지 마십시오. (JSON 순수 텍스트만 출력)
{
  "summary": "가계의 현재 소비 요약 한 줄 평 (예: '이번 달은 온라인 쇼핑 지출이 평소보다 25% 늘어났지만, 고정 지출을 성공적으로 통제한 한 달입니다.')",
  "content": "여기에 상세한 마크다운 리포트 본문 텍스트를 기재하십시오. 줄바꿈은 \n 으로 이스케이프해야 합니다."
}

3. content (마크다운 리포트 본문)에 반드시 포함되어야 할 항목:
   - ## 📊 가계부 종합 요약: 수입과 지출의 균형, 예산 준수율 등을 명확한 수치와 함께 요약.
   - ## 🔍 주요 소비 카테고리 분석: 가장 높은 지출을 차지한 상위 3개 카테고리에 대한 지출 요인 분석.
   - ## ✨ 이번 달의 긍정적인 소비 습관: 이전 대비 절약했거나 잘한 부분 칭찬.
   - ## ⚠️ 개선 및 주의가 필요한 영역: 충동 소비 경향이 있거나 불필요하게 낭비된 부문 지적.
   - ## 💡 다음 달 저축 및 예산 제안: 실현 가능한 저축액 목표 제시 및 예산 최적화 팁 제안.

예시 출력 형식:
{
  "summary": "온라인 쇼핑이 급증했으나 외식비를 아껴 전체 예산을 방어했습니다.",
  "content": "## 📊 가계부 종합 요약\n이번 달 총 지출은...\n\n## 🔍 주요 소비 카테고리 분석\n- **외식비**: 지난 달 대비...\n"
}
""".trimIndent()

        val responseText = callAiText(config, prompt) ?: return null
        val payload = normalizeJsonText(responseText) ?: return null
        val result = try {
            aiJson.parseToJsonElement(payload).jsonObject
        } catch (_: Exception) {
            return Pair("AI 소비 분석 리포트", responseText)
        }

        val summary = result["summary"]?.jsonPrimitive?.contentOrNull?.trim() ?: "소비 분석이 완료되었습니다."
        val content = result["content"]?.jsonPrimitive?.contentOrNull?.trim() ?: responseText.trim()

        return Pair(summary, content)
    }

    /**
     * LLM API 호출 헬퍼
     */
    private suspend fun callAiText(config: AIConfig, prompt: String): String? = withContext(Dispatchers.IO) {
        try {
            when (config.provider.ifBlank { "gemini" }) {
                "gemini" -> {
                    if (config.apiKey.isBlank()) return@withContext null
                    val body = buildString {
                        append("{\"contents\":[{\"parts\":[{\"text\":")
                        append(JsonPrimitive(prompt).toString())
                        append("}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}")
                    }
                    val response = postJson(
                        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${config.apiKey}",
                        body
                    )
                    val data = aiJson.parseToJsonElement(response).jsonObject
                    data["candidates"]?.jsonArray?.getOrNull(0)?.jsonObject
                        ?.get("content")?.jsonObject
                        ?.get("parts")?.jsonArray?.getOrNull(0)?.jsonObject
                        ?.get("text")?.jsonPrimitive?.contentOrNull
                }
                "openai" -> {
                    if (config.apiKey.isBlank()) return@withContext null
                    val body = buildString {
                        append("{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":")
                        append(JsonPrimitive(prompt).toString())
                        append("}],\"response_format\":{\"type\":\"json_object\"}}")
                    }
                    val response = postJson(
                        "https://api.openai.com/v1/chat/completions",
                        body,
                        mapOf("Authorization" to "Bearer ${config.apiKey}")
                    )
                    val data = aiJson.parseToJsonElement(response).jsonObject
                    data["choices"]?.jsonArray?.getOrNull(0)?.jsonObject
                        ?.get("message")?.jsonObject
                        ?.get("content")?.jsonPrimitive?.contentOrNull
                }
                "local" -> {
                    if (config.localIp.isBlank()) return@withContext null
                    val model = if (config.localModel.isBlank()) "local-model" else config.localModel
                    val body = buildString {
                        append("{\"model\":\"")
                        append(model)
                        append("\",\"messages\":[{\"role\":\"user\",\"content\":")
                        append(JsonPrimitive(prompt).toString())
                        append("}]}")
                    }
                    val response = postJson("${config.localIp.trimEnd('/')}/chat/completions", body)
                    val data = aiJson.parseToJsonElement(response).jsonObject
                    data["choices"]?.jsonArray?.getOrNull(0)?.jsonObject
                        ?.get("message")?.jsonObject
                        ?.get("content")?.jsonPrimitive?.contentOrNull
                }
                else -> null
            }
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun normalizeJsonText(responseText: String): String? {
        var text = responseText.trim()
        if (text.startsWith("```")) {
            text = text.replace(Regex("^```json\\s*", RegexOption.IGNORE_CASE), "")
                .replace(Regex("```$"), "")
                .trim()
        }
        return text.ifBlank { null }
    }

    private fun postJson(url: String, body: String, headers: Map<String, String> = emptyMap()): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("Content-Type", "application/json")
            headers.forEach { (key, value) -> setRequestProperty(key, value) }
        }

        try {
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(body)
            }

            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                throw IllegalStateException("HTTP $code: $response")
            }
            return response
        } finally {
            connection.disconnect()
        }
    }
}
