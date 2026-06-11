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
- "used_point" (e.g. (?<used_point>[\\d,]+)): Extracts points/credits used (optional).

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
