package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import kotlinx.serialization.json.*

/**
 * @file TransactionApiHandler.kt
 * @summary 거래 내역 관련 API 요청 처리 모듈
 * @description 가계부 지출/수입 등록, 사용처 자동 학습, 결제수단 자동 매핑 및 상세 거래내역 검색/조회/삭제 처리를 담당합니다.
 * @dependencies
 *   - AndroidApiHandler.kt (공통 DB 헬퍼 및 JSON 직렬화기 사용)
 *   - Entities.kt / Daos.kt (Room DB 엔티티 및 DAO 인터페이스)
 */
object TransactionApiHandler {

    suspend fun handleTransactionRequest(
        context: Context,
        db: SpendLogDatabase,
        path: String,
        method: String,
        body: String?,
        queryParams: Map<String, String>
    ): ApiResponse {
        val json = AndroidApiHandler.json

        return if (method == "POST" && body != null) {
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

            val payType = bodyObj["pay_type"]?.jsonPrimitive?.contentOrNull ?: "CREDIT"

            val tx = Transaction(
                id = idLong,
                type = type,
                amount = amount,
                merchant = merchant,
                category = category,
                payMethod = payMethod,
                payType = payType,
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
            val resultList = AndroidApiHandler.queryRaw(db, sql, params.toTypedArray())
            ApiResponse(body = resultList)
        }
    }
}
