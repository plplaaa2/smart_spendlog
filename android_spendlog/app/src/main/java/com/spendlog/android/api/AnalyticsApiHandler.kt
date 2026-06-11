package com.spendlog.android.api

import android.content.Context
import com.spendlog.android.MainActivity.ApiResponse
import com.spendlog.android.data.*
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
                
                val allTimeRows = AndroidApiHandler.queryRaw(db,
                    "SELECT pay_method, " +
                    "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as total_income, " +
                    "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as total_expense, " +
                    "SUM(COALESCE(used_point, 0)) as total_used_point " +
                    "FROM transactions GROUP BY pay_method"
                )
                val allTimeMap = allTimeRows.associateBy { it.jsonObject["pay_method"]?.jsonPrimitive?.contentOrNull ?: "" }
                
                val monthRows = AndroidApiHandler.queryRaw(db,
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
                            
                            val customRow = AndroidApiHandler.queryRawSingle(db,
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
    }
}
