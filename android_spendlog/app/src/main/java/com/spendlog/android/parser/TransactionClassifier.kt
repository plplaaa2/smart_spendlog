package com.spendlog.android.parser

/**
 * [TransactionClassifier.kt]
 * - 요약: 수신된 알림 텍스트의 키워드(입금, 출금, 결제, 취소 등) 분석을 통해 거래 유형(수입/지출/승인취소/입금취소)을 3단계로 선제 구분 판정하는 모듈입니다.
 * - 연결된 파일 목록:
 *   - NotificationParser.kt (파싱 처리 시 거래 유형 결정을 위해 호출)
 */
object TransactionClassifier {

    data class TransactionTypeInfo(
        val transactionType: String,
        val customMemo: String
    )

    /**
     * 알림 텍스트의 상태 키워드 및 패턴 기반 거래 유형 결정
     */
    fun determineTransactionType(
        normalizedText: String,
        matchedStatus: String?,
        ruleType: String
    ): TransactionTypeInfo {
        val isDeposit = Regex("입금|환불|입금완료|수입|저축").containsMatchIn(normalizedText)
        val isWithdrawal = Regex("출금|송금|지출|결제|승인|사용|신용|체크").containsMatchIn(normalizedText)
        val isCancel = Regex("취소|반품").containsMatchIn(normalizedText)

        var preemptiveType: String? = null
        if (isCancel) {
            preemptiveType = if (Regex("입금취소|입금\\s*취소|수입취소").containsMatchIn(normalizedText)) {
                "EXPENSE"
            } else {
                "INCOME"
            }
        } else if (isDeposit && !isWithdrawal) {
            preemptiveType = "INCOME"
        } else if (isWithdrawal && !isDeposit) {
            preemptiveType = "EXPENSE"
        }

        var transactionType: String
        var customMemo = ""

        if (preemptiveType != null) {
            transactionType = preemptiveType
            if (isCancel) {
                customMemo = if (Regex("입금취소|입금\\s*취소|수입취소").containsMatchIn(normalizedText)) {
                    "[입금취소] "
                } else {
                    "[승인취소] "
                }
            }
        } else {
            transactionType = ruleType
            if (matchedStatus != null) {
                val cleanStatus = matchedStatus.trim()
                if (Regex("입금|수입|저축|환불|입금완료").containsMatchIn(cleanStatus)) {
                    transactionType = "INCOME"
                } else if (Regex("출금|송금|지출|결제|승인|사용|신용|체크").containsMatchIn(cleanStatus)) {
                    transactionType = "EXPENSE"
                }

                if (Regex("취소|반품").containsMatchIn(cleanStatus)) {
                    if (Regex("입금취소|입금\\s*취소|수입취소").containsMatchIn(normalizedText)) {
                        transactionType = "EXPENSE"
                        customMemo = "[입금취소] "
                    } else {
                        transactionType = "INCOME"
                        customMemo = "[승인취소] "
                    }
                }
            } else {
                val isDep = Regex("입금|환불|입금완료|수입|저축").containsMatchIn(normalizedText)
                val isWith = Regex("출금|송금|지출|결제|승인|사용|신용|체크").containsMatchIn(normalizedText)

                if (isDep && !isWith) {
                    transactionType = "INCOME"
                } else if (isWith && !isDep) {
                    transactionType = "EXPENSE"
                }

                if (Regex("취소|승인취소|반품").containsMatchIn(normalizedText)) {
                    if (Regex("입금취소|입금\\s*취소|수입취소").containsMatchIn(normalizedText)) {
                        transactionType = "EXPENSE"
                        customMemo = "[입금취소] "
                    } else {
                        transactionType = "INCOME"
                        customMemo = "[승인취소] "
                    }
                }
            }
        }

        return TransactionTypeInfo(transactionType, customMemo)
    }
}
