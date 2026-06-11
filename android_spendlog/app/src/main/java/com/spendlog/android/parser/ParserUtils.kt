package com.spendlog.android.parser

import java.util.regex.Pattern

/**
 * [ParserUtils.kt]
 * - 요약: 파싱 및 정규식 조립 시 공통적으로 사용하는 유틸리티 함수(정규식 특수문자 이스케이프, 가맹점 상호명 정제 등) 및 관련 데이터 클래스들을 정의하는 파일입니다.
 * - 연결된 파일 목록:
 *   - Constants.kt (매핑 데이터 제공)
 *   - BrandMapper.kt (브랜드 괄호 추가 시 이스케이프 헬퍼 호출)
 *   - NotificationParser.kt (메인 파서 및 추천 정규식 빌더 진입점)
 */
object ParserUtils {

    data class Block(
        val type: String,
        val start: Int,
        val end: Int,
        val regex: String,
        val value: String
    )

    data class Gap(
        val start: Int,
        val end: Int,
        val index: Int
    )

    /**
     * 가맹점명 정제 로직
     * 주식회사 표시 및 불필요한 앞뒤 특수문자/공백 제거
     */
    fun cleanMerchantName(merchant: String?): String {
        if (merchant.isNullOrEmpty()) return "알수없음"
        
        // 줄바꿈이 있는 경우 첫 줄만 선택
        var cleaned = merchant.split("\n")[0].split("\r")[0].trim()
        
        // 주식회사 등의 수식어 제거
        cleaned = cleaned.replace(Regex("^\\((주|합|유|재|사)\\)|^\\(주식회사\\)"), "")
        cleaned = cleaned.replace(Regex("\\((주|합|유|재|사)\\)$|\\(주식회사\\)$"), "")
        cleaned = cleaned.replace(Regex("^주식회사\\s+|\\s+주식회사$"), "")
        
        // 앞뒤 불필요한 문장부호 및 공백 정제
        cleaned = cleaned.replace(Regex("^[\\s, .\\-_#@*&()\\[\\]{}]+|[\\s, .\\-_#@*&()\\[\\]{}]+$"), "")
        
        return if (cleaned.isEmpty()) "알수없음" else cleaned
    }

    /**
     * 정규식 생성 및 조립을 위해 특수 기호 이스케이프 처리
     */
    fun escapeRegexChars(str: String): String {
        return str.replace(Regex("[\\-\\/\\\\\\^\\$\\*\\+\\?\\.\\(\\)\\|\\[\\]\\{\\}]"), "\\\\$0")
    }
}
