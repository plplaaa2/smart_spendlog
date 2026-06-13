package com.spendlog.android.parser

import com.spendlog.android.data.Rule
import com.spendlog.android.data.PassRule
import com.spendlog.android.data.SpendLogDatabase
import java.util.*
import java.util.regex.Pattern

data class ParsedResult(
    val amount: Long,
    val merchant: String,
    val datetime: String,
    val payMethod: String,
    val payType: String,
    val category: String,
    val type: String,
    val ruleId: Int?,
    val ruleName: String?,
    val usedPoint: Long,
    val memo: String
)

/**
 * [NotificationParser.kt]
 * - 요약: 수신된 알림 문자/푸시 메시지를 저장된 정규식 규칙 목록과 대조하여 가계부 데이터(금액, 상호, 거래일시, 결제수단 등)로 파싱하는 메인 흐름 제어 및 정규식 추천 빌더 모듈입니다.
 * - 연결된 파일 목록:
 *   - Constants.kt (매핑 데이터 호출)
 *   - BrandMapper.kt (브랜드 보정 헬퍼 호출)
 *   - PaymentResolver.kt (결제 방식 및 카드 변환 호출)
 *   - DatetimeParser.kt (유연한 일시 파싱 및 KST 시간 호출)
 *   - TransactionClassifier.kt (수입/지출 거래유형 판별 호출)
 *   - AiParser.kt (LLM API 호출 및 패턴 생성 호출)
 *   - ParserUtils.kt (이스케이프 및 정제 유틸 호출)
 */
object NotificationParser {

    /**
     * 알림 제외(패스) 규칙 매칭 여부 체크
     */
    fun checkPassRules(text: String, passRules: List<PassRule>): Boolean {
        if (text.isEmpty()) return false
        val normalizedText = text.replace(Regex("[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]"), "").replace("\r\n", "\n")
        for (rule in passRules) {
            try {
                val pattern = Pattern.compile(rule.pattern, Pattern.DOTALL)
                if (pattern.matcher(normalizedText).find()) return true
            } catch (e: Exception) {}
        }
        return false
    }

    /**
     * 알림 메시지 파싱 실행 메인 함수
     */
    suspend fun parseNotification(
        text: String,
        rules: List<Rule>,
        db: SpendLogDatabase,
        packageName: String,
        fallbackDatetime: String? = null
    ): ParsedResult? {
        if (text.isEmpty()) return null

        val normalizedText = text.replace(Regex("[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]"), "").replace("\r\n", "\n")

        for (rule in rules) {
            try {
                val pattern = Pattern.compile(rule.pattern, Pattern.DOTALL)
                val matcher = pattern.matcher(normalizedText)

                if (matcher.find()) {
                    // 1. 금액(Amount) 파싱
                    val amountStr = try { matcher.group("amount") } catch (e: Exception) { null }
                    val amount = amountStr?.replace(",", "")?.filter { it.isDigit() }?.toLongOrNull() ?: continue

                    // 금액 문자열 위치 기반 날짜 오인 검사
                    var amountStart = -1
                    var amountEnd = -1
                    try {
                        amountStart = matcher.start("amount")
                        amountEnd = matcher.end("amount")
                    } catch (e: Exception) {}

                    if (amountStart != -1 && amountEnd != -1) {
                        val dateTimeRegexes = listOf(
                            Pattern.compile("\\b\\d{4}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}\\b"),
                            Pattern.compile("\\b\\d{1,2}[.\\-/]\\d{1,2}\\b"),
                            Pattern.compile("\\b\\d{1,2}월\\s*\\d{1,2}일\\b"),
                            Pattern.compile("\\b\\d{2}:\\d{2}(?::\\d{2})?\\b")
                        )
                        var isDateTime = false
                        for (dtPattern in dateTimeRegexes) {
                            val dtMatcher = dtPattern.matcher(normalizedText)
                            while (dtMatcher.find()) {
                                val dtStart = dtMatcher.start()
                                val dtEnd = dtMatcher.end()
                                if (amountStart >= dtStart && amountEnd <= dtEnd) {
                                    isDateTime = true
                                    break
                                }
                            }
                            if (isDateTime) break
                        }
                        if (isDateTime) continue
                    }

                    // 2. 상호명(Merchant) 파싱 및 보정
                    var merchant = try { matcher.group("merchant") ?: matcher.group("usage") ?: "알수없음" } catch (e: Exception) { "알수없음" }
                    merchant = ParserUtils.cleanMerchantName(merchant)
                    merchant = BrandMapper.addKoreanBrandName(merchant)

                    // 3. 거래일시(Datetime) 파싱
                    val timeStr = try { matcher.group("time") ?: matcher.group("datetime") ?: matcher.group("date") } catch (e: Exception) { null }
                    var datetime = DatetimeParser.parseFlexibleDatetime(timeStr)

                    if (datetime.isEmpty()) {
                        datetime = fallbackDatetime ?: DatetimeParser.getCurrentKSTDatetime()
                    }

                    // 4. 결제수단(Pay Method) 설정
                    var payMethod = try {
                        matcher.group("payMethod") ?: matcher.group("pay_method") ?: rule.payMethod
                    } catch (e: Exception) {
                        try { matcher.group("pay_method") ?: rule.payMethod } catch (e2: Exception) { rule.payMethod }
                    }
                    payMethod = payMethod.trim()

                    // 앱 패키지명 기준 매핑이 있으면 최우선적으로 덮어씌움 (백엔드 webhook.js 와 일관성 일치)
                    if (packageName.isNotEmpty()) {
                        val mapped = db.packagePayMethodDao().getPackagePayMethodByPackage(packageName)?.pay_method
                        if (!mapped.isNullOrEmpty()) {
                            payMethod = mapped
                        }
                    }

                    if (payMethod == "_AUTO_MAPPING_") {
                        payMethod = "카드"
                    }

                    // 결제 방식 결정 (정규식 그룹 매칭이 우선, 다음으로 규칙에 지정된 payType, 없거나 UNKNOWN 이면 텍스트로부터 판별)
                    var paymentType = try {
                        matcher.group("payType") ?: matcher.group("pay_type") ?: rule.payType
                    } catch (e: Exception) {
                        try { matcher.group("pay_type") ?: rule.payType } catch (e2: Exception) { rule.payType }
                    }

                    // 하위 호환성 보정: 만약 payMethod에 결제방식 관련 단어가 잘못 캡처된 경우 보정
                    if (payMethod == "신용" || payMethod == "체크" || payMethod == "이체" || payMethod == "송금" || payMethod == "현금") {
                        if (paymentType.isEmpty() || paymentType == "UNKNOWN") {
                            paymentType = payMethod
                        }
                        payMethod = rule.payMethod
                    }
                    if (payMethod.isEmpty()) {
                        payMethod = "카드"
                    }

                    if (paymentType.isNotEmpty()) {
                        val cleanPt = paymentType.trim()
                        paymentType = when {
                            cleanPt.contains("체크") -> "CHECK"
                            cleanPt.contains("이체") || cleanPt.contains("송금") -> "TRANSFER"
                            cleanPt.contains("현금") -> "CASH"
                            cleanPt.contains("신용") || cleanPt.contains("일시불") || cleanPt.contains("할부") -> "CREDIT"
                            else -> cleanPt
                        }
                    }
                    if (paymentType.isEmpty() || paymentType == "UNKNOWN") {
                        val detectedType = PaymentResolver.parsePaymentType(normalizedText, payMethod)
                        paymentType = if (detectedType == "BANK_TRANSFER") "TRANSFER" else detectedType
                    }
                    if (paymentType.isEmpty() || paymentType == "UNKNOWN") {
                        paymentType = "CREDIT" // 기본값
                    }

                    // 5. 카테고리(Category) 자동 매핑
                    var category = rule.category
                    if (category == "_AUTO_MAPPING_") {
                        category = findCategoryByMerchant(db, merchant) ?: "기타"
                    }

                    // 6. 사용 포인트(Used Point) 추출
                    val usedPointStr = try {
                        matcher.group("usedPoint") ?: matcher.group("used_point")
                    } catch (e: Exception) {
                        try { matcher.group("used_point") } catch (e2: Exception) { null }
                    }
                    var usedPoint = usedPointStr?.replace(",", "")?.toLongOrNull() ?: 0L
                    if (usedPoint == 0L) {
                        val pointMatch = Pattern.compile("(?:포인트|점수|P|마일리지|하트)\\s*([\\d,]+)", Pattern.CASE_INSENSITIVE).matcher(normalizedText)
                        if (pointMatch.find()) {
                            usedPoint = pointMatch.group(1)?.replace(",", "")?.toLongOrNull() ?: 0L
                        }
                    }

                    // 7. 메모 및 거래 유형(수입/지출) 결정
                    val account = try { matcher.group("account") } catch (e: Exception) { null }
                    val balance = try { matcher.group("balance") } catch (e: Exception) { null }
                    val cumulative = try { matcher.group("cumulative") } catch (e: Exception) { null }
                    val memoParts = mutableListOf<String>()
                    if (account != null) memoParts.add("계좌: ${account.trim()}")
                    if (balance != null) memoParts.add("잔액: ${balance.trim()}")
                    if (cumulative != null) memoParts.add("누적: ${cumulative.trim()}")
                    
                    val matchedStatus = try { matcher.group("status") ?: matcher.group("type_text") } catch (e: Exception) { null }
                    val txInfo = TransactionClassifier.determineTransactionType(normalizedText, matchedStatus, rule.type)

                    val memo = txInfo.customMemo + memoParts.joinToString(" | ")

                    return ParsedResult(
                        amount = amount,
                        merchant = merchant,
                        datetime = datetime,
                        payMethod = payMethod,
                        payType = paymentType,
                        category = category,
                        type = txInfo.transactionType,
                        ruleId = rule.id,
                        ruleName = rule.name,
                        usedPoint = usedPoint,
                        memo = memo
                    )
                }
            } catch (e: Exception) {
                // Ignore or log
            }
        }
        return null
    }

    /**
     * 상호명을 이용해 매핑 데이터베이스에서 저장된 카테고리를 추론
     */
    private suspend fun findCategoryByMerchant(db: SpendLogDatabase, merchantName: String): String? {
        if (merchantName.isEmpty()) return null

        // 1. 정확한 일치 우선
        val exact = db.merchantCategoryDao().getMerchantCategoryByMerchant(merchantName)
        if (exact != null) return exact.category

        // 2. 부분 일치 검색 및 예외 조건 방어
        val allMappings = db.merchantCategoryDao().getAllMerchantCategories()
        val upperMerchant = merchantName.uppercase()
        
        val matchedMapping = allMappings.find { mapping ->
            val keyword = mapping.merchant
            if (keyword.isNotEmpty()) {
                val upperKeyword = keyword.uppercase()
                val idx = upperMerchant.indexOf(upperKeyword)
                if (idx != -1) {
                    if (upperKeyword == "마트" && upperMerchant.contains("스마트")) {
                        false
                    } else {
                        if (idx + upperKeyword.length < upperMerchant.length) {
                            val nextChar = upperMerchant[idx + upperKeyword.length]
                            nextChar !in '가'..'힣'
                        } else {
                            true
                        }
                    }
                } else false
            } else false
        }
        
        return matchedMapping?.category
    }

    /**
     * [AI 정규식 생성 기능의 문법 및 구성 유효성 검사 (c63 방어막)]
     * 정규식 문법 적합성 및 필수 Named Capture Group(?<amount>, ?<merchant>)의 존재 검사
     */
    fun validateRegexPattern(patternStr: String): Boolean {
        return try {
            Pattern.compile(patternStr)
            patternStr.contains("(?<amount>") && (patternStr.contains("(?<merchant>") || patternStr.contains("(?<usage>"))
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 텍스트로부터 추천 정규식 패턴을 자동 빌드하는 알고리즘
     */
    suspend fun generatePatternFromText(text: String, db: SpendLogDatabase? = null): String? {
        if (text.isEmpty()) return null

        val cleanText = text.replace(Regex("[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]"), "").replace(Regex("\\[Web발신\\]\\s*", RegexOption.IGNORE_CASE), "")
        val blocks = mutableListOf<ParserUtils.Block>()

        fun isOverlapping(start: Int, end: Int): Boolean {
            return blocks.any { b -> Math.max(start, b.start) < Math.min(end, b.end) }
        }

        // 1. 카드명/은행명 감지
        val cardRegex = Pattern.compile("\\[(.*?)\\]")
        val fallbackCardRegex = Pattern.compile("(NH농협|신한카드|삼성카드|현대카드|롯데카드|우리카드|하나카드|국민카드|농협카드|비씨카드|BC카드|카카오뱅크|토스뱅크|케이뱅크|신한은행|국민은행|우리은행|하나은행|농협은행|기업은행|IBK|우체국|새마을금고|새마을|신협|수협은행|수협|씨티은행|씨티|SC제일은행|SC제일|산업은행|저축은행|광주은행|제주은행|전북은행|대구은행|부산은행|경남은행|증권|카카오페이|네이버페이)")
        
        var cardMatcher = cardRegex.matcher(cleanText)
        var cardFound = cardMatcher.find()
        var startCard = -1
        var endCard = -1
        var cardVal = ""
        var isBracket = false

        if (cardFound) {
            cardVal = cardMatcher.group(1) ?: ""
            startCard = cardMatcher.start()
            endCard = cardMatcher.end()
            isBracket = true
        } else {
            val fbMatcher = fallbackCardRegex.matcher(cleanText)
            if (fbMatcher.find()) {
                cardVal = fbMatcher.group()
                startCard = fbMatcher.start()
                endCard = fbMatcher.end()
            }
        }

        if (startCard != -1 && endCard != -1) {
            val isDepositOrWithdraw = isBracket && ((cardVal.length <= 5 && (cardVal.contains("출금") || cardVal.contains("입금"))) || cardVal.any { it.isDigit() })
            if (!isDepositOrWithdraw) {
                if (!isOverlapping(startCard, endCard)) {
                    val escRegex = if (isBracket) "\\[(?<payMethod>${ParserUtils.escapeRegexChars(cardVal)})\\]" else "(?<payMethod>${ParserUtils.escapeRegexChars(cardVal)})"
                    blocks.add(ParserUtils.Block("카드명/은행명", startCard, endCard, escRegex, cardVal))
                }
            }
        }

        // 2. 시간/일시 감지
        val timeRegexes = listOf(
            Pattern.compile("\\d{4}[/\\-.]\\d{1,2}[/\\-.]\\d{1,2}\\s+\\d{2}:\\d{2}(?::\\d{2})?"),
            Pattern.compile("\\d{2}[/\\-.]\\d{1,2}[/\\-.]\\d{1,2}\\s+\\d{2}:\\d{2}(?::\\d{2})?"),
            Pattern.compile("\\d{1,2}월\\s*\\d{1,2}일\\s*\\d{2}:\\d{2}(?::\\d{2})?"),
            Pattern.compile("\\d{2}[/\\-.]\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?"),
            Pattern.compile("\\d{2}:\\d{2}(?::\\d{2})?")
        )

        var timeFound = false
        for (tr in timeRegexes) {
            val tm = tr.matcher(cleanText)
            if (tm.find()) {
                val rawTime = tm.group()
                val start = tm.start()
                val end = tm.end()
                if (!isOverlapping(start, end)) {
                    var regex = "(?<time>\\d{2}:\\d{2}(?::\\d{2})?)"
                    if (rawTime.contains("월") && rawTime.contains("일")) {
                        regex = "(?<time>\\d{1,2}월\\s*\\d{1,2}일\\s*\\d{2}:\\d{2}(?::\\d{2})?)"
                    } else if (rawTime.contains(":") && (rawTime.contains("/") || rawTime.contains("-") || rawTime.contains("."))) {
                        val sepMatch = Regex("[/\\-.]").find(rawTime)
                        if (sepMatch != null) {
                            val sep = sepMatch.value
                            val partCount = rawTime.split(sep).size - 1
                            if (partCount == 2) {
                                val yearLen = rawTime.split(sep)[0].length
                                regex = "(?<time>\\d{$yearLen}${ParserUtils.escapeRegexChars(sep)}\\d{1,2}${ParserUtils.escapeRegexChars(sep)}\\d{1,2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)"
                            } else {
                                regex = "(?<time>\\d{2}${ParserUtils.escapeRegexChars(sep)}\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?)"
                            }
                        }
                    }
                    blocks.add(ParserUtils.Block("시간", start, end, regex, rawTime))
                    timeFound = true
                }
                break
            }
        }

        if (!timeFound) {
            val dateRegexes = listOf(
                Pattern.compile("\\d{2}[/\\-.]\\d{2}"),
                Pattern.compile("\\d{1,2}월\\s*\\d{1,2}일")
            )
            for (dr in dateRegexes) {
                val dm = dr.matcher(cleanText)
                if (dm.find()) {
                    val rawDate = dm.group()
                    val start = dm.start()
                    val end = dm.end()
                    if (!isOverlapping(start, end)) {
                        var regex = "(?<time>\\d{2}[/\\-.]\\d{2})"
                        if (rawDate.contains("월")) {
                            regex = "(?<time>\\d{1,2}월\\s*\\d{1,2}일)"
                        } else {
                            val sepMatch = Regex("[/\\-.]").find(rawDate)
                            if (sepMatch != null) {
                                val sep = sepMatch.value
                                regex = "(?<time>\\d{2}${ParserUtils.escapeRegexChars(sep)}\\d{2})"
                            }
                        }
                        blocks.add(ParserUtils.Block("날짜", start, end, regex, rawDate))
                    }
                    break
                }
            }
        }

        // 3. 금액 감지 ("원"이 붙어있는 금액 우선)
        val amountWithWonRegex = Pattern.compile("([\\d,]+)\\s*원")
        val awMatcher = amountWithWonRegex.matcher(cleanText)
        var amountDetected = false
        while (awMatcher.find()) {
            val start = awMatcher.start()
            val end = awMatcher.end()
            if (!isOverlapping(start, end)) {
                val regexStr = "(?<amount>[\\d,]+)원"
                blocks.add(ParserUtils.Block("금액", start, end, regexStr, awMatcher.group()))
                amountDetected = true
                break
            }
        }

        // 3-2. "원"이 안 붙은 순수 숫자 금액 감지
        if (!amountDetected) {
            val nakedAmountRegex = Pattern.compile("(?<!\\d|\\*|-)([1-9]\\d{0,2}(?:,\\d{3})+|[1-9]\\d{3,8})(?!\\d|\\*|-)")
            val naMatcher = nakedAmountRegex.matcher(cleanText)
            while (naMatcher.find()) {
                val start = naMatcher.start()
                val end = naMatcher.end()
                if (!isOverlapping(start, end)) {
                    val prefix = cleanText.substring(Math.max(0, start - 10), start)
                    if (!prefix.contains("잔액") && !prefix.contains("잔고")) {
                        blocks.add(ParserUtils.Block("금액", start, end, "(?<amount>[\\d,]+)", naMatcher.group()))
                        amountDetected = true
                        break
                    }
                }
            }
        }

        // 4. 잔액 감지
        val balanceRegex = Pattern.compile("(?:잔액|잔고)\\s*:?\\s*([\\d,]+)\\s*원?")
        val balMatcher = balanceRegex.matcher(cleanText)
        if (balMatcher.find()) {
            val start = balMatcher.start()
            val end = balMatcher.end()
            if (!isOverlapping(start, end)) {
                val regex = if (balMatcher.group().contains("원"))
                    "(?:잔액|잔고)\\s*:?\\s*(?<balance>[\\d,]+)원"
                else
                    "(?:잔액|잔고)\\s*:?\\s*(?<balance>[\\d,]+)"
                blocks.add(ParserUtils.Block("잔액", start, end, regex, balMatcher.group()))
            }
        }

        // 5. 누적금액 감지
        val cumulativeRegex = Pattern.compile("누적(?:.*?금액)?\\s*:?\\s*([\\d,]+)\\s*원?")
        val cumMatcher = cumulativeRegex.matcher(cleanText)
        if (cumMatcher.find()) {
            val start = cumMatcher.start()
            val end = cumMatcher.end()
            if (!isOverlapping(start, end)) {
                val regex = if (cumMatcher.group().contains("원"))
                    "누적(?:.*?금액)?\\s*:?\\s*(?<cumulative>[\\d,]+)원"
                else
                    "누적(?:.*?금액)?\\s*:?\\s*(?<cumulative>[\\d,]+)"
                blocks.add(ParserUtils.Block("누적금액", start, end, regex, cumMatcher.group()))
            }
        }

        // 6. 포인트/마일리지 감지
        val pointRegex = Pattern.compile("(?:포인트|점수|P|마일리지|하트)\\s*([\\d,]+)\\s*(?:원|점|P)?", Pattern.CASE_INSENSITIVE)
        val ptMatcher = pointRegex.matcher(cleanText)
        if (ptMatcher.find()) {
            val start = ptMatcher.start()
            val end = ptMatcher.end()
            if (!isOverlapping(start, end)) {
                blocks.add(ParserUtils.Block("포인트차감", start, end, "(?:포인트|P)\\s*(?<used_point>[\\d,]+)\\s*(?:원|점|P)?", ptMatcher.group()))
            }
        }

        // 상태 감지
        val statusRegex = Pattern.compile("(승인|사용|취소|출금|입금|결제)")
        val stMatcher = statusRegex.matcher(cleanText)
        while (stMatcher.find()) {
            val start = stMatcher.start()
            val end = stMatcher.end()
            if (!isOverlapping(start, end)) {
                blocks.add(ParserUtils.Block("상태", start, end, ParserUtils.escapeRegexChars(stMatcher.group()), stMatcher.group()))
            }
        }

        // 결제방식 감지
        val payMethodRegexes = listOf(
            Pattern.compile("(?:신용|체크)(?:\\(일시불,[\\d*]+\\))?"),
            Pattern.compile("(?:신용|체크|일시불|\\d+개월\\s*할부)")
        )
        var payMethodFound = false
        for (pmr in payMethodRegexes) {
            val pmm = pmr.matcher(cleanText)
            if (pmm.find()) {
                val start = pmm.start()
                val end = pmm.end()
                if (!isOverlapping(start, end)) {
                    blocks.add(ParserUtils.Block("결제방식", start, end, "(?<payType>[^\\s/]+)", pmm.group()))
                    payMethodFound = true
                }
                break
            }
        }

        // 7. 계좌번호 감지
        val accountRegexes = listOf(
            Pattern.compile("\\d{3,}\\*+[-\\d*]*"),
            Pattern.compile("[-\\d*]*\\*+[-\\d*]*"),
            Pattern.compile("\\d{3,}[-\\d*]{2,}"),
            Pattern.compile("[\\d*-]{5,}")
        )
        for (acRegex in accountRegexes) {
            val acMatcher = acRegex.matcher(cleanText)
            while (acMatcher.find()) {
                val valStr = acMatcher.group()
                if (valStr.contains("/") || valStr.contains(":") || valStr.contains("원")) continue
                if (!valStr.any { it.isDigit() || it == '-' }) continue
                val start = acMatcher.start()
                val end = acMatcher.end()
                if (!isOverlapping(start, end)) {
                    blocks.add(ParserUtils.Block("계좌번호", start, end, "(?<account>[\\d*-]+)", valStr))
                }
            }
        }

        // 8. 고객명/예금주명 마스킹 감지
        val nameRegex = Pattern.compile("[가-힣]\\*[가-힣](?:님|대님)?")
        val nameMatcher = nameRegex.matcher(cleanText)
        if (nameMatcher.find()) {
            val start = nameMatcher.start()
            val end = nameMatcher.end()
            if (!isOverlapping(start, end)) {
                blocks.add(ParserUtils.Block("고객명", start, end, "[가-힣]\\*[가-힣](?:님|대님)?", nameMatcher.group()))
            }
        }

        // 블록 정렬 및 Gap 계산
        blocks.sortBy { it.start }
        val gaps = mutableListOf<ParserUtils.Gap>()
        if (blocks.isEmpty()) {
            return "\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*"
        }

        gaps.add(ParserUtils.Gap(0, blocks[0].start, 0))
        for (i in 1 until blocks.size) {
            gaps.add(ParserUtils.Gap(blocks[i - 1].end, blocks[i].start, i))
        }
        gaps.add(ParserUtils.Gap(blocks.last().end, cleanText.length, blocks.size))

        var bestGapIndex = -1
        var maxScore = -Double.MAX_VALUE
        var maxCleanLen = -1

        val franchisePresets = mutableListOf<String>().apply {
            addAll(FranchisePresets.presets.map { it.keyword })
            if (db != null) {
                try {
                    addAll(db.merchantCategoryDao().getAllMerchantCategories().map { mc -> mc.merchant })
                } catch (e: Exception) {
                    // Ignore DB read errors
                }
            }
        }

        gaps.forEach { g ->
            val txt = cleanText.substring(g.start, g.end)
            val cleanTxt = txt.replace(Regex("\\[?(입금|출금|잔액|잔고|누적|결제)\\]?"), "").trim()
            val cleanLetters = cleanTxt.replace(Regex("[^가-힣a-zA-Z]"), "")
            val len = cleanLetters.length
            if (len > 0) {
                if (len > maxCleanLen) {
                    maxCleanLen = len
                }

                var score = 0.0
                if (len in 2..8) {
                    score += 15.0
                } else if (len in 9..12) {
                    score += 10.0
                } else if (len == 1) {
                    score += 2.0
                } else {
                    score -= (len - 12) * 1.5
                }

                var minAmtDist = Int.MAX_VALUE
                var minStatusDist = Int.MAX_VALUE

                blocks.forEach { b ->
                    if (b.type == "금액") {
                        val dist = Math.min(Math.abs(g.start - b.end), Math.abs(b.start - g.end))
                        if (dist < minAmtDist) minAmtDist = dist
                    }
                    if (b.type == "상태") {
                        val dist = Math.min(Math.abs(g.start - b.end), Math.abs(b.start - g.end))
                        if (dist < minStatusDist) minStatusDist = dist
                    }
                }

                if (minAmtDist <= 3) {
                    score += 10.0
                } else if (minAmtDist <= 10) {
                    score += 5.0
                }

                if (minStatusDist <= 3) {
                    score += 8.0
                } else if (minStatusDist <= 10) {
                    score += 4.0
                }

                val systemKeywords = listOf(
                    Regex("타행이체", RegexOption.IGNORE_CASE),
                    Regex("즉시이체", RegexOption.IGNORE_CASE),
                    Regex("계좌이체", RegexOption.IGNORE_CASE),
                    Regex("모바일", RegexOption.IGNORE_CASE),
                    Regex("뱅킹", RegexOption.IGNORE_CASE),
                    Regex("인터넷", RegexOption.IGNORE_CASE),
                    Regex("수수료", RegexOption.IGNORE_CASE),
                    Regex("이자", RegexOption.IGNORE_CASE),
                    Regex("안내", RegexOption.IGNORE_CASE),
                    Regex("공지", RegexOption.IGNORE_CASE),
                    Regex("고객", RegexOption.IGNORE_CASE),
                    Regex("인증", RegexOption.IGNORE_CASE),
                    Regex("보안", RegexOption.IGNORE_CASE),
                    Regex("점검", RegexOption.IGNORE_CASE),
                    Regex("대기", RegexOption.IGNORE_CASE),
                    Regex("완료", RegexOption.IGNORE_CASE),
                    Regex("감사", RegexOption.IGNORE_CASE),
                    Regex("이용", RegexOption.IGNORE_CASE),
                    Regex("확인", RegexOption.IGNORE_CASE),
                    Regex("등록", RegexOption.IGNORE_CASE),
                    Regex("성공", RegexOption.IGNORE_CASE),
                    Regex("실패", RegexOption.IGNORE_CASE),
                    Regex("[가-힣]{2,4}\\s*님")
                )
                var hasSystemKeyword = false
                for (kw in systemKeywords) {
                    if (kw.containsMatchIn(txt)) {
                        hasSystemKeyword = true
                        break
                    }
                }
                if (hasSystemKeyword) {
                    score -= 30.0
                }

                var matchesFranchise = false
                for (keyword in franchisePresets) {
                    if (keyword.length >= 2 && txt.contains(keyword)) {
                        matchesFranchise = true
                        break
                    }
                }
                if (matchesFranchise) {
                    score += 20.0
                }

                if (score > maxScore) {
                    maxScore = score
                    bestGapIndex = g.index
                }
            }
        }

        // 최종 조립
        var finalRegex = "^"
        if (text.contains("[Web발신]")) {
            finalRegex += "(?:(?:\\s*\\[Web발신\\]\\s*|\\s*)?)?"
        }

        var lastIndex = 0
        val usedTypes = mutableSetOf<String>()

        fun formatGapToRegex(gapText: String): String {
            if (gapText.isEmpty()) return ""
            val result = StringBuilder()
            var i = 0
            while (i < gapText.length) {
                val char = gapText[i]
                if (char.isWhitespace()) {
                    result.append("\\s*")
                    while (i < gapText.length && gapText[i].isWhitespace()) {
                        i++
                    }
                } else {
                    result.append(ParserUtils.escapeRegexChars(char.toString()))
                    i++
                }
            }
            return result.toString()
        }

        for (i in 0 until blocks.size) {
            val b = blocks[i]
            val prefixGap = cleanText.substring(lastIndex, b.start)

            if (i == bestGapIndex && maxCleanLen > 0) {
                // [사용처 구분자 분리] 가맹점 영역 뒤에 슬래시(/)가 존재할 경우 강제 분리 처리 (연결 파일: pattern_generator.js, rules.js)
                val slashRegex = Regex("^(.*?)\\s*/\\s*$")
                val slashMatch = slashRegex.find(prefixGap)
                if (slashMatch != null) {
                    val merchantPart = slashMatch.groupValues[1]
                    val hasNums = merchantPart.any { it.isDigit() }
                    finalRegex += if (hasNums) "\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*/\\s*" else "\\s*(?<merchant>.+?)\\s*/\\s*"
                } else {
                    val hasNums = prefixGap.any { it.isDigit() }
                    finalRegex += if (hasNums) "\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?\\s*" else "\\s*(?<merchant>.+?)\\s*"
                }
            } else {
                finalRegex += formatGapToRegex(prefixGap)
            }

            var blockRegex = b.regex
            if (usedTypes.contains(b.type)) {
                blockRegex = blockRegex.replace(Regex("\\(\\?<[a-zA-Z0-9_]+>"), "(?:")
            } else {
                usedTypes.add(b.type)
            }

            finalRegex += blockRegex
            lastIndex = b.end
        }

        val suffixGap = cleanText.substring(lastIndex)
        if (blocks.size == bestGapIndex && maxCleanLen > 0) {
            val slashMatch = Regex("^\\s*\\/\\s*(.+)").find(suffixGap)
            val hasNums = suffixGap.any { it.isDigit() }
            finalRegex += if (slashMatch != null) {
                if (hasNums) "\\s*\\/\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?$" else "\\s*\\/\\s*(?<merchant>.+)$"
            } else {
                if (hasNums) "\\s*(?<merchant>.+?)(?:\\s+[\\d,]+)?$" else "\\s*(?<merchant>.+)$"
            }
        } else {
            finalRegex += formatGapToRegex(suffixGap) + "$"
        }

        return finalRegex
    }

    /**
     * AI 모델을 사용해 알림 원문 파싱 (AiParser로 위임)
     */
    suspend fun parseNotificationWithAI(
        text: String,
        config: AIConfig,
        fallbackDatetime: String? = null
    ): ParsedResult? {
        return AiParser.parseNotificationWithAI(text, config, fallbackDatetime)
    }

    /**
     * AI 모델을 사용해 정규식 패턴 생성 (AiParser로 위임)
     */
    suspend fun generatePatternWithAI(text: String, config: AIConfig): String? {
        return AiParser.generatePatternWithAI(text, config)
    }
}
