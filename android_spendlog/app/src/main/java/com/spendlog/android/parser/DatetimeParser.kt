package com.spendlog.android.parser

import java.text.SimpleDateFormat
import java.util.*
import java.util.regex.Pattern

/**
 * [DatetimeParser.kt]
 * - 요약: 다양한 유형의 알림 메시지 내 거래 날짜와 시간 포맷(한글 날짜 형식, 구분자 날짜, 순수 숫자 형태 등)을 파싱하여 가계부 데이터베이스 규격인 "YYYY-MM-DD HH:mm:ss" 형태로 표준화하는 정밀 가이드 파서 모듈입니다.
 * - 연결된 파일 목록:
 *   - NotificationParser.kt (파싱 처리 시 시간 정보 획득에 사용)
 */
object DatetimeParser {

    /**
     * 유연한 날짜/시간 정규화 처리
     */
    fun parseFlexibleDatetime(timeStr: String?): String {
        if (timeStr == null) return ""
        val now = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"))
        val currentYear = now.get(Calendar.YEAR)

        // 1. 요일 표시 제거
        var cleanStr = timeStr.replace(Regex("\\([가-힣a-zA-Z]{1,3}\\)"), "")
            .replace(Regex("\\[[가-힣a-zA-Z]{1,3}\\]"), "")
            .trim()

        // 2. 오전/오후 감지 및 변환
        val isPM = cleanStr.contains("오후") || cleanStr.contains("PM", ignoreCase = true)
        cleanStr = cleanStr.replace(Regex("오전|오후|AM|PM", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+"), " ")
            .trim()

        try {
            // 후보 1: 표준 YYYY-MM-DD HH:mm:ss 또는 MM/DD HH:mm
            val stdRegex = Regex("(?:(\\d{4})[-/.])?(\\d{1,2})[-/.](\\d{1,2})\\s+(\\d{1,2}):(\\d{1,2})(?::(\\d{1,2}))?")
            val stdMatch = stdRegex.find(cleanStr)
            if (stdMatch != null) {
                val year = stdMatch.groupValues[1].takeIf { it.isNotEmpty() }?.toInt() ?: currentYear
                val month = stdMatch.groupValues[2].padStart(2, '0')
                val day = stdMatch.groupValues[3].padStart(2, '0')
                var hour = stdMatch.groupValues[4].toInt()
                if (isPM && hour < 12) hour += 12
                if (!isPM && hour == 12) hour = 0
                val min = stdMatch.groupValues[5].padStart(2, '0')
                val sec = stdMatch.groupValues[6].takeIf { it.isNotEmpty() }?.padStart(2, '0') ?: "00"
                return "$year-$month-$day ${hour.toString().padStart(2, '0')}:$min:$sec"
            }

            // 후보 2: 한글 날짜 형식 (M월 D일 H시 m분)
            val koRegex = Regex("(?:(\\d{4})년\\s*)?(\\d{1,2})월\\s*(\\d{1,2})일\\s*(\\d{1,2})시\\s*(\\d{1,2})분(?:\\s*(\\d{1,2})초)?")
            val koMatch = koRegex.find(cleanStr)
            if (koMatch != null) {
                val year = koMatch.groupValues[1].takeIf { it.isNotEmpty() }?.toInt() ?: currentYear
                val month = koMatch.groupValues[2].padStart(2, '0')
                val day = koMatch.groupValues[3].padStart(2, '0')
                var hour = koMatch.groupValues[4].toInt()
                if (isPM && hour < 12) hour += 12
                if (!isPM && hour == 12) hour = 0
                val min = koMatch.groupValues[5].padStart(2, '0')
                val sec = koMatch.groupValues[6].takeIf { it.isNotEmpty() }?.padStart(2, '0') ?: "00"
                return "$year-$month-$day ${hour.toString().padStart(2, '0')}:$min:$sec"
            }

            // 추가 후보 3: 순수 숫자 날짜 형식 digitMatch (8, 12, 14자리)
            val digitRegex = Regex("\\b(\\d{8}|\\d{12}|\\d{14})\\b")
            val digitMatch = digitRegex.find(cleanStr)
            if (digitMatch != null) {
                val valStr = digitMatch.groupValues[1]
                if (valStr.length == 8) {
                    // YYYYMMDD 검증
                    val yearA = valStr.substring(0, 4).toIntOrNull() ?: 0
                    val monthA = valStr.substring(4, 6).toIntOrNull() ?: 0
                    val dayA = valStr.substring(6, 8).toIntOrNull() ?: 0
                    val isValidYYYYMMDD = (yearA in 1900..2100) && (monthA in 1..12) && (dayA in 1..31)

                    // MMDDHHmm 검증
                    val monthB = valStr.substring(0, 2).toIntOrNull() ?: 0
                    val dayB = valStr.substring(2, 4).toIntOrNull() ?: 0
                    val hourB = valStr.substring(4, 6).toIntOrNull() ?: 0
                    val minuteB = valStr.substring(6, 8).toIntOrNull() ?: 0
                    val isValidMMDDHHmm = (monthB in 1..12) && (dayB in 1..31) && (hourB in 0..23) && (minuteB in 0..59)

                    if (isValidYYYYMMDD) {
                        return "$yearA-${monthA.toString().padStart(2, '0')}-${dayA.toString().padStart(2, '0')} 00:00:00"
                    } else if (isValidMMDDHHmm) {
                        var hour = hourB
                        if (isPM && hour < 12) hour += 12
                        return "$currentYear-${monthB.toString().padStart(2, '0')}-${dayB.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minuteB.toString().padStart(2, '0')}:00"
                    }
                } else if (valStr.length == 12) {
                    val year = "20" + valStr.substring(0, 2)
                    val month = valStr.substring(2, 4)
                    val day = valStr.substring(4, 6)
                    var hour = valStr.substring(6, 8).toIntOrNull() ?: 0
                    if (isPM && hour < 12) hour += 12
                    val minute = valStr.substring(8, 10)
                    val second = valStr.substring(10, 12)
                    return "$year-$month-$day ${hour.toString().padStart(2, '0')}:$minute:$second"
                } else if (valStr.length == 14) {
                    val year = valStr.substring(0, 4)
                    val month = valStr.substring(4, 6)
                    val day = valStr.substring(6, 8)
                    var hour = valStr.substring(8, 10).toIntOrNull() ?: 0
                    if (isPM && hour < 12) hour += 12
                    val minute = valStr.substring(10, 12)
                    val second = valStr.substring(12, 14)
                    return "$year-$month-$day ${hour.toString().padStart(2, '0')}:$minute:$second"
                }
            }

            // 후보 4: 시간만 매칭되는 경우 (HH:mm:ss)
            val timeOnlyRegex = Regex("^(\\d{1,2}):(\\d{1,2})(?::(\\d{1,2}))?$")
            val timeOnlyMatch = timeOnlyRegex.find(cleanStr)
            if (timeOnlyMatch != null) {
                val year = currentYear
                val month = (now.get(Calendar.MONTH) + 1).toString().padStart(2, '0')
                val day = now.get(Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
                var hour = timeOnlyMatch.groupValues[1].toInt()
                if (isPM && hour < 12) hour += 12
                if (!isPM && hour == 12) hour = 0
                val min = timeOnlyMatch.groupValues[2].padStart(2, '0')
                val sec = timeOnlyMatch.groupValues[3].takeIf { it.isNotEmpty() }?.padStart(2, '0') ?: "00"
                return "$year-$month-$day ${hour.toString().padStart(2, '0')}:$min:$sec"
            }
        } catch (e: Exception) {}

        return ""
    }

    /**
     * 현재 한국 표준시(KST) 날짜 및 시간 반환
     */
    fun getCurrentKSTDatetime(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREAN)
        sdf.timeZone = TimeZone.getTimeZone("Asia/Seoul")
        return sdf.format(Date())
    }
}
