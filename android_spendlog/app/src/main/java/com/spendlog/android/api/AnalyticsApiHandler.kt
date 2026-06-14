package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
import com.spendlog.android.parser.*
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import java.text.SimpleDateFormat
import java.util.*

/**
 * @file AnalyticsApiHandler.kt
 * @summary 자산 통계 및 소비/수입 분석 API 요청 처리 모듈
 * @description 대시보드 통계 집계, 최근 12개월 추이, 월별 상세/연간/고정지출/일반지출/수입 분석 쿼리를 수행하고
 *              Room DB의 원시 커서 데이터를 JSON으로 변환하여 반환합니다.
 * @dependencies
 *   - AndroidApiHandler.kt (공통 DB 헬퍼 및 JSON 직렬화기 사용)
 *   - Entities.kt / Daos.kt (Room DB 엔티티 및 DAO 인터페이스)
 */
object AnalyticsApiHandler {

    suspend fun handleAnalyticsRequest(
        context: Context,
        db: SpendLogDatabase,
        path: String,
        method: String,
        body: String?,
        queryParams: Map<String, String>
    ): ApiResponse {
        val json = AndroidApiHandler.json

        return when {
            path == "stats" -> {
                val month = queryParams["month"] ?: SimpleDateFormat("yyyy-MM", Locale.US).format(Date())
                
                val totalRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
                    "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
                    "FROM transactions WHERE datetime LIKE ?", arrayOf("$month%")
                )
                val totalExpense = totalRow?.get("expense")?.jsonPrimitive?.longOrNull ?: 0L
                val totalIncome = totalRow?.get("income")?.jsonPrimitive?.longOrNull ?: 0L
                
                val categoryRows = AndroidApiHandler.queryRaw(db,
                    "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' GROUP BY category ORDER BY total DESC",
                    arrayOf("$month%")
                )
                
                val dailyRows = AndroidApiHandler.queryRaw(db,
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
                        val r = AndroidApiHandler.queryRawSingle(db,
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
                
                val cardToBankMap = mapOf(
                    "NH농협카드" to "NH농협은행",
                    "농협카드" to "NH농협은행",
                    "NH농협" to "NH농협은행",
                    "농협" to "NH농협은행",
                    "신한카드" to "신한은행",
                    "신한" to "신한은행",
                    "국민카드" to "KB국민은행",
                    "KB국민카드" to "KB국민은행",
                    "국민" to "KB국민은행",
                    "KB국민" to "KB국민은행",
                    "우리카드" to "우리은행",
                    "우리" to "우리은행",
                    "하나카드" to "하나은행",
                    "하나" to "하나은행",
                    "IBK기업은행" to "기업은행",
                    "기업은행" to "기업은행",
                    "기업" to "기업은행",
                    "IBK" to "기업은행",
                    "카카오뱅크" to "카카오뱅크",
                    "토스뱅크" to "토스뱅크",
                    "케이뱅크" to "케이뱅크",
                    "우체국" to "우체국",
                    "새마을금고" to "새마을금고",
                    "신협" to "신협",
                    "수협" to "수협은행"
                )

                val allTimeRowsRaw = AndroidApiHandler.queryRaw(db,
                    "SELECT pay_method, pay_type, " +
                    "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as total_income, " +
                    "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as total_expense, " +
                    "SUM(COALESCE(used_point, 0)) as total_used_point " +
                    "FROM transactions GROUP BY pay_method, pay_type"
                )
                
                data class AggregatedRow(
                    var totalIncome: Long = 0L,
                    var totalExpense: Long = 0L,
                    var totalUsedPoint: Long = 0L
                )
                val allTimeMap = mutableMapOf<String, AggregatedRow>()
                for (row in allTimeRowsRaw) {
                    val rowObj = row.jsonObject
                    val rawPayMethod = rowObj["pay_method"]?.jsonPrimitive?.contentOrNull ?: ""
                    val payType = rowObj["pay_type"]?.jsonPrimitive?.contentOrNull ?: "CREDIT"
                    val totalIncome = rowObj["total_income"]?.jsonPrimitive?.longOrNull ?: 0L
                    val totalExpense = rowObj["total_expense"]?.jsonPrimitive?.longOrNull ?: 0L
                    val totalUsedPoint = rowObj["total_used_point"]?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val resolvedPayMethod = if (payType == "CHECK" || payType == "TRANSFER") {
                        cardToBankMap[rawPayMethod] ?: rawPayMethod
                    } else {
                        rawPayMethod
                    }
                    
                    val agg = allTimeMap.getOrPut(resolvedPayMethod) { AggregatedRow() }
                    agg.totalIncome += totalIncome
                    agg.totalExpense += totalExpense
                    agg.totalUsedPoint += totalUsedPoint
                }
                
                val monthRowsRaw = AndroidApiHandler.queryRaw(db,
                    "SELECT pay_method, pay_type, " +
                    "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
                    "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
                    "FROM transactions WHERE datetime LIKE ? GROUP BY pay_method, pay_type", arrayOf("$month%")
                )
                
                data class MonthAggregatedRow(
                    var monthIncome: Long = 0L,
                    var monthExpense: Long = 0L
                )
                val monthMap = mutableMapOf<String, MonthAggregatedRow>()
                for (row in monthRowsRaw) {
                    val rowObj = row.jsonObject
                    val rawPayMethod = rowObj["pay_method"]?.jsonPrimitive?.contentOrNull ?: ""
                    val payType = rowObj["pay_type"]?.jsonPrimitive?.contentOrNull ?: "CREDIT"
                    val monthIncome = rowObj["month_income"]?.jsonPrimitive?.longOrNull ?: 0L
                    val monthExpense = rowObj["month_expense"]?.jsonPrimitive?.longOrNull ?: 0L
                    
                    val resolvedPayMethod = if (payType == "CHECK" || payType == "TRANSFER") {
                        cardToBankMap[rawPayMethod] ?: rawPayMethod
                    } else {
                        rawPayMethod
                    }
                    
                    val agg = monthMap.getOrPut(resolvedPayMethod) { MonthAggregatedRow() }
                    agg.monthIncome += monthIncome
                    agg.monthExpense += monthExpense
                }
                
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
                            
                            val customRow = AndroidApiHandler.queryRawSingle(db,
                                "SELECT SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
                                "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
                                "FROM transactions WHERE pay_method = ? AND datetime >= ? AND datetime <= ?",
                                arrayOf(name, startStr, endStr)
                            )
                            
                            val agg = monthMap.getOrPut(name) { MonthAggregatedRow() }
                            agg.monthIncome = customRow?.get("month_income")?.jsonPrimitive?.longOrNull ?: 0L
                            agg.monthExpense = customRow?.get("month_expense")?.jsonPrimitive?.longOrNull ?: 0L
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
                        
                        val allTime = allTimeMap[name]
                        val totalIncome = allTime?.totalIncome ?: 0L
                        val totalExpense = allTime?.totalExpense ?: 0L
                        val totalUsedPt = allTime?.totalUsedPoint ?: 0L
                        
                        val mTime = monthMap[name]
                        val mIncome = mTime?.monthIncome ?: 0L
                        val mExpense = mTime?.monthExpense ?: 0L
                        
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
                val rows = AndroidApiHandler.queryRaw(db, """
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
                
                val dailyRows = AndroidApiHandler.queryRaw(db, """
                    SELECT 
                      strftime('%d', datetime) as day,
                      SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
                      SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
                    FROM transactions
                    WHERE datetime LIKE ?
                    GROUP BY day
                    ORDER BY day ASC
                """.trimIndent(), arrayOf("$targetMonth%"))
                
                val categoryRows = AndroidApiHandler.queryRaw(db, """
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
                
                val monthlyRows = AndroidApiHandler.queryRaw(db, """
                    SELECT 
                      strftime('%m', datetime) as month,
                      SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
                      SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
                    FROM transactions
                    WHERE datetime LIKE ?
                    GROUP BY month
                    ORDER BY month ASC
                """.trimIndent(), arrayOf("$year%"))
                
                val categoryCompare = AndroidApiHandler.queryRaw(db, """
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
                    
                    val categoryCompare = AndroidApiHandler.queryRaw(db, """
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
                    val categoryCompare = AndroidApiHandler.queryRaw(db, """
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
                
                val totalSpentRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                    arrayOf(targetPattern)
                )
                val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val fixedTotalRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders)",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                val fixedTotal = fixedTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val categoryRows = AndroidApiHandler.queryRaw(db,
                    "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders) GROUP BY category ORDER BY total DESC",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                
                val transactionRows = AndroidApiHandler.queryRaw(db,
                    "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN ($placeholders) ORDER BY datetime DESC",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                
                val trendArray = buildJsonArray {
                    if (isYearly) {
                        val trendRows = AndroidApiHandler.queryRaw(db,
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
                            val trendRow = AndroidApiHandler.queryRawSingle(db,
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
                
                val totalSpentRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                    arrayOf(targetPattern)
                )
                val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val generalTotalRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders)",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                val generalTotal = generalTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val categoryRows = AndroidApiHandler.queryRaw(db,
                    "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders) GROUP BY category ORDER BY total DESC",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                
                val transactionRows = AndroidApiHandler.queryRaw(db,
                    "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN ($placeholders) ORDER BY datetime DESC",
                    arrayOf(targetPattern, *fixedCategories.toTypedArray())
                )
                
                val trendArray = buildJsonArray {
                    if (isYearly) {
                        val trendRows = AndroidApiHandler.queryRaw(db,
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
                            val trendRow = AndroidApiHandler.queryRawSingle(db,
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
                
                val incomeTotalRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
                    arrayOf(targetPattern)
                )
                val incomeTotal = incomeTotalRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val totalSpentRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                    arrayOf(targetPattern)
                )
                val totalSpent = totalSpentRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L
                
                val categoryRows = AndroidApiHandler.queryRaw(db,
                    "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' GROUP BY category ORDER BY total DESC",
                    arrayOf(targetPattern)
                )
                
                val transactionRows = AndroidApiHandler.queryRaw(db,
                    "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' ORDER BY datetime DESC",
                    arrayOf(targetPattern)
                )
                
                val trendArray = buildJsonArray {
                    if (isYearly) {
                        val trendRows = AndroidApiHandler.queryRaw(db,
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
                            val trendRow = AndroidApiHandler.queryRawSingle(db,
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
                val year = queryParams["year"]
                val month = queryParams["month"]
                if (year.isNullOrEmpty() || month.isNullOrEmpty()) {
                    return ApiResponse(status = 400, body = buildJsonObject {
                        put("error", "조회할 연도(year)와 월(month)을 지정해 주세요.")
                    })
                }

                val reportType = if (month == "all") "YEARLY" else "MONTHLY"
                val targetMonth = if (month == "all") 0 else (month.toIntOrNull() ?: 1)
                val targetYear = year.toIntOrNull() ?: 2026

                val report = db.aiReportDao().getAiReport(reportType, targetYear, targetMonth)

                if (report != null) {
                    ApiResponse(body = buildJsonObject {
                        put("success", true)
                        put("report", buildJsonObject {
                            put("summary", report.summary)
                            put("content", report.content)
                            put("created_at", report.createdAt)
                        })
                    })
                } else {
                    ApiResponse(body = buildJsonObject {
                        put("success", false)
                        put("message", "생성된 AI 소비 리포트가 없습니다.")
                    })
                }
            }
            path == "analytics/ai-report/generate" && method == "POST" && body != null -> {
                val jsonObject = json.parseToJsonElement(body).jsonObject
                val year = jsonObject["year"]?.jsonPrimitive?.contentOrNull ?: ""
                val month = jsonObject["month"]?.jsonPrimitive?.contentOrNull ?: ""
                if (year.isEmpty() || month.isEmpty()) {
                    return ApiResponse(status = 400, body = buildJsonObject {
                        put("error", "생성할 연도(year)와 월(month)을 지정해 주세요.")
                    })
                }

                val isYearly = (month == "all")
                val targetYear = year.toIntOrNull() ?: 2026
                val targetMonth = if (isYearly) 0 else (month.toIntOrNull() ?: 1)
                val reportType = if (isYearly) "YEARLY" else "MONTHLY"

                // 1. AI 설정 조회 및 검증
                val settings = db.settingsDao().getSettings() ?: Settings()
                if (!settings.ai_enabled) {
                    return ApiResponse(status = 400, body = buildJsonObject {
                        put("error", "AI 기능이 비활성화 상태입니다. 설정 탭의 AI 설정에서 먼저 활성화해 주세요.")
                    })
                }

                val provider = settings.ai_provider
                val apiKey = settings.ai_api_key

                if (provider == "gemini" || provider == "openai") {
                    if (apiKey.isBlank() || apiKey == "******") {
                        return ApiResponse(status = 400, body = buildJsonObject {
                            put("error", "유효한 AI API Key가 설정되어 있지 않습니다. 설정 탭의 AI 설정에서 API Key를 입력 후 저장해 주세요.")
                        })
                    }
                } else if (provider == "local") {
                    if (settings.ai_local_ip.isBlank()) {
                        return ApiResponse(status = 400, body = buildJsonObject {
                            put("error", "로컬 API 주소(IP)가 설정되어 있지 않습니다. 설정 탭의 AI 설정에서 로컬 API 주소를 입력해 주세요.")
                        })
                    }
                }

                val aiConfig = AIConfig(
                    provider = provider,
                    apiKey = apiKey,
                    localIp = settings.ai_local_ip,
                    localModel = settings.ai_local_model
                )

                // 2. 가계부 데이터 수집
                val targetPattern = if (isYearly) "$year%" else "$year-${month.padStart(2, '0')}%"

                // 총 수입액 (이체/입금 제외)
                val incomeRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
                    arrayOf(targetPattern)
                )
                val totalIncome = incomeRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L

                // 총 지출액 (이체/송금 제외)
                val expenseRow = AndroidApiHandler.queryRawSingle(db,
                    "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
                    arrayOf(targetPattern)
                )
                val totalExpense = expenseRow?.get("total")?.jsonPrimitive?.longOrNull ?: 0L

                // 카테고리별 지출 내역
                val categories = AndroidApiHandler.queryRaw(db,
                    "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' GROUP BY category ORDER BY total DESC",
                    arrayOf(targetPattern)
                )

                // 예산 설정값
                val budget = settings.monthlyBudget

                // 월별/일자별 추이 데이터 집계
                val trendText = StringBuilder()
                if (isYearly) {
                    val monthlyData = AndroidApiHandler.queryRaw(db,
                        "SELECT strftime('%m', datetime) as mm, " +
                        "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as inc, " +
                        "SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as exp " +
                        "FROM transactions WHERE datetime LIKE ? GROUP BY mm ORDER BY mm ASC",
                        arrayOf(targetPattern)
                    )
                    for (m in monthlyData) {
                        val mObj = m.jsonObject
                        val mm = mObj["mm"]?.jsonPrimitive?.contentOrNull ?: ""
                        val inc = mObj["inc"]?.jsonPrimitive?.longOrNull ?: 0L
                        val exp = mObj["exp"]?.jsonPrimitive?.longOrNull ?: 0L
                        trendText.append("  - ${mm}월: 수입 ${java.lang.String.format("%,d", inc)}원, 지출 ${java.lang.String.format("%,d", exp)}원\n")
                    }
                } else {
                    val dailyExpenses = AndroidApiHandler.queryRaw(db,
                        "SELECT strftime('%d', datetime) as dd, SUM(amount) as total " +
                        "FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' " +
                        "GROUP BY dd ORDER BY total DESC LIMIT 5",
                        arrayOf(targetPattern)
                    )
                    for (d in dailyExpenses) {
                        val dObj = d.jsonObject
                        val dd = dObj["dd"]?.jsonPrimitive?.contentOrNull ?: ""
                        val total = dObj["total"]?.jsonPrimitive?.longOrNull ?: 0L
                        trendText.append("  - ${dd}일 지출 합계: ${java.lang.String.format("%,d", total)}원\n")
                    }
                }

                // dataText 조립
                val dataText = if (isYearly) {
                    val categoriesText = StringBuilder()
                    for (c in categories) {
                        val cObj = c.jsonObject
                        val cat = cObj["category"]?.jsonPrimitive?.contentOrNull ?: ""
                        val total = cObj["total"]?.jsonPrimitive?.longOrNull ?: 0L
                        val percent = if (totalExpense > 0L) (total.toDouble() / totalExpense * 100.0) else 0.0
                        categoriesText.append("  - $cat: ${java.lang.String.format("%,d", total)}원 (${java.lang.String.format("%.1f", percent)}%)\n")
                    }

                    """
                    [${year}년 연간 가계 통계 데이터]
                    - 총 수입: ${java.lang.String.format("%,d", totalIncome)}원 (이체/입금 제외)
                    - 총 지출: ${java.lang.String.format("%,d", totalExpense)}원 (이체/송금 제외)
                    - 순수익 (수입-지출): ${java.lang.String.format("%,d", totalIncome - totalExpense)}원
                    - 연간 총 예산: ${if (budget > 0) java.lang.String.format("%,d", budget * 12) + "원" else "설정되지 않음"}
                    - 카테고리별 지출 비중:
                    $categoriesText
                    - 월별 수입 및 지출 흐름:
                    ${if (trendText.isNotEmpty()) trendText.toString() else "  (기록된 월별 데이터 없음)"}
                    """.trimIndent()
                } else {
                    val categoriesText = StringBuilder()
                    for (c in categories) {
                        val cObj = c.jsonObject
                        val cat = cObj["category"]?.jsonPrimitive?.contentOrNull ?: ""
                        val total = cObj["total"]?.jsonPrimitive?.longOrNull ?: 0L
                        val percent = if (totalExpense > 0L) (total.toDouble() / totalExpense * 100.0) else 0.0
                        categoriesText.append("  - $cat: ${java.lang.String.format("%,d", total)}원 (${java.lang.String.format("%.1f", percent)}%)\n")
                    }

                    val budgetString = if (budget > 0) java.lang.String.format("%,d", budget) + "원" else "설정되지 않음"
                    val budgetPercent = if (budget > 0) java.lang.String.format("%.1f", (totalExpense.toDouble() / budget * 100.0)) + "%" else "N/A"

                    """
                    [${year}년 ${month}월 가계 통계 데이터]
                    - 총 수입: ${java.lang.String.format("%,d", totalIncome)}원 (이체/입금 제외)
                    - 총 지출: ${java.lang.String.format("%,d", totalExpense)}원 (이체/송금 제외)
                    - 순수익 (수입-지출): ${java.lang.String.format("%,d", totalIncome - totalExpense)}원
                    - 이번 달 설정 예산: $budgetString
                    - 예산 소진율: $budgetPercent
                    - 카테고리별 지출 비중:
                    $categoriesText
                    - 일자별 주요 지출 일(상위 5일):
                    ${if (trendText.isNotEmpty()) trendText.toString() else "  (기록된 지출 없음)"}
                    """.trimIndent()
                }

                // 3. AI 소비 리포트 작성 호출
                val reportResult = try {
                    AiParser.generateConsumptionReportWithAI(dataText, aiConfig)
                } catch (e: Exception) {
                    e.printStackTrace()
                    android.util.Log.e("SpendLogAPI", "AI Report Generation Exception: ${e.message}", e)
                    return ApiResponse(status = 500, body = buildJsonObject {
                        put("success", false)
                        put("error", "AI 소비 리포트 생성 실패: ${e.localizedMessage ?: e.message ?: "알 수 없는 오류"}")
                    })
                }

                // 4. DB에 저장
                val now = System.currentTimeMillis()
                val aiReport = AiReport(
                    reportType = reportType,
                    targetYear = targetYear,
                    targetMonth = targetMonth,
                    summary = reportResult.first,
                    content = reportResult.second,
                    createdAt = now
                )
                db.aiReportDao().insertAiReport(aiReport)

                ApiResponse(body = buildJsonObject {
                    put("success", true)
                    put("report", buildJsonObject {
                        put("summary", reportResult.first)
                        put("content", reportResult.second)
                        put("created_at", now)
                    })
                })
            }
            else -> ApiResponse(status = 404, body = buildJsonObject { put("error", "Not Found") })
        }
    }
}
