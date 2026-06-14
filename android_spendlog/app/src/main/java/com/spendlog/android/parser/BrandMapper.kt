package com.spendlog.android.parser

import java.util.regex.Pattern

/**
 * [BrandMapper.kt]
 * - 요약: 영문 브랜드명이 포함된 가맹점명에 대해 한글 브랜드명을 동적으로 괄호 안에 병기해 주는 보정 헬퍼 모듈입니다.
 * - 연결된 파일 목록:
 *   - Constants.kt (BRAND_MAP 활용)
 *   - ParserUtils.kt (escapeRegexChars 유틸 호출)
 *   - NotificationParser.kt (메인 파싱 단계에서 가맹점명 보정에 호출)
 */
object BrandMapper {

    // 브랜드 키 목록을 길이 역순으로 정렬 (더 긴 매칭 우선 처리)
    private val BRAND_KEYS_SORTED = Constants.BRAND_MAP.keys.sortedByDescending { it.length }

    // 영문 브랜드 감지용 컴파일 정규식
    private val BRAND_ENG_REGEX: Pattern by lazy {
        val patternStr = "(?:${BRAND_KEYS_SORTED.joinToString("|") { ParserUtils.escapeRegexChars(it) }})[a-zA-Z]*"
        Pattern.compile(patternStr, Pattern.CASE_INSENSITIVE)
    }

    /**
     * 영문 브랜드명 감지 시 한글명 괄호 추가 처리
     * 예: "STARBUCKS COFFEE" -> "STARBUCKS(스타벅스) COFFEE"
     * (이미 한글명이 포함된 경우 중복 방지를 위해 그대로 반환)
     */
    fun addKoreanBrandName(merchant: String?): String {
        if (merchant.isNullOrEmpty()) return "알수없음"

        val matcher = BRAND_ENG_REGEX.matcher(merchant)
        if (matcher.find()) {
            val matchedEng = matcher.group()
            val brandKey = matchedEng.uppercase()
            // 매칭된 영문명이 시작하는 브랜드 상호 키 찾기
            val originalKey = BRAND_KEYS_SORTED.find { brandKey.startsWith(it) }
            val kor = originalKey?.let { Constants.BRAND_MAP[it] }

            // 한글명이 존재하고, 기존 가맹점명에 한글명이 아직 포함되지 않은 경우에만 병기 처리 (caution.jsonl c34 규칙 적용)
            if (kor != null && !merchant.contains(kor)) {
                val replacePattern = Pattern.compile(ParserUtils.escapeRegexChars(matchedEng), Pattern.CASE_INSENSITIVE)
                return replacePattern.matcher(merchant).replaceFirst("$matchedEng($kor)")
            }
        }

        return merchant
    }
}
