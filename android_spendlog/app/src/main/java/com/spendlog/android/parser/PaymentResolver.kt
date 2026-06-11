package com.spendlog.android.parser

/**
 * [PaymentResolver.kt]
 * - 요약: 알림 승인 내역의 텍스트와 원본 결제수단명을 기반으로 결제 유형(신용, 체크, 계좌이체 등)을 판별하고, 체크카드 승인 내역 시 자동 계좌 매핑 처리를 지원합니다.
 * - 연결된 파일 목록:
 *   - Constants.kt (CARD_TO_BANK_MAP, BANK_HINTS 활용)
 *   - NotificationParser.kt (파싱 처리 시 결제 수단 및 카드 변환 호출)
 */
object PaymentResolver {

    /**
     * 체크카드 결제 건에 대해 연동된 은행(계좌) 결제수단명으로 자동 치환
     */
    fun convertCardToBank(payMethod: String, text: String): String {
        var targetBank = Constants.CARD_TO_BANK_MAP[payMethod]

        if (targetBank == null) {
            for ((hint, bankName) in Constants.BANK_HINTS) {
                if (text.contains(hint)) {
                    targetBank = bankName
                    break
                }
            }
        }

        if (targetBank == null && payMethod.contains("카드")) {
            targetBank = "계좌이체"
        }

        return targetBank ?: payMethod
    }

    /**
     * 알림 원문 및 결제수단을 토대로 신용(CREDIT), 체크(CHECK), 계좌이체(BANK_TRANSFER) 여부 판별
     */
    fun parsePaymentType(text: String?, payMethod: String?): String {
        val normalizedText = text ?: ""
        val normalizedPayMethod = payMethod ?: ""

        if (normalizedText.contains("체크") || normalizedPayMethod.contains("체크")) {
            return "CHECK"
        }
        if (normalizedText.contains("신용") || normalizedPayMethod.contains("신용") || 
            normalizedText.contains("일시불") || Regex("할부").containsMatchIn(normalizedText)) {
            return "CREDIT"
        }
        
        val isTransfer = Regex("출금|입금|이체|송금").containsMatchIn(normalizedText)
        val isBankMethod = normalizedPayMethod.contains("은행") || normalizedPayMethod.contains("뱅크") ||
                listOf("우체국", "새마을금고", "신협", "수협", "계좌이체").contains(normalizedPayMethod)
                
        if (isTransfer && isBankMethod) {
            return "BANK_TRANSFER"
        }
        return "UNKNOWN"
    }
}
