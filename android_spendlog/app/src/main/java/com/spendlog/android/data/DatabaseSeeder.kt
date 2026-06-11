package com.spendlog.android.data

import android.content.Context
import com.spendlog.android.parser.FranchisePresets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object DatabaseSeeder {
    suspend fun seedIfEmpty(context: Context) {
        val db = SpendLogDatabase.getDatabase(context)
        val ruleDao = db.ruleDao()
        val passRuleDao = db.passRuleDao()
        val categoryDao = db.categoryDao()
        val payMethodDao = db.payMethodDao()
        val merchantCategoryDao = db.merchantCategoryDao()

        withContext(Dispatchers.IO) {
            // 1. Seed Categories if empty
            if (categoryDao.getAllCategories().isEmpty()) {
                val categories = listOf(
                    Category("외식비", "EXPENSE", "utensils", "#ff6b6b"),
                    Category("음료/카페", "EXPENSE", "coffee", "#c8956c"),
                    Category("배달음식", "EXPENSE", "bike", "#ff922b"),
                    Category("마트/편의점", "EXPENSE", "store", "#38bdf8"),
                    Category("디저트", "EXPENSE", "cake", "#f783ac"),
                    Category("패션/의류", "EXPENSE", "shirt", "#ae3ec9"),
                    Category("온라인쇼핑", "EXPENSE", "shopping-bag", "#4dadf7"),
                    Category("해외직구", "EXPENSE", "globe", "#15aabf"),
                    Category("교통/주유", "EXPENSE", "car", "#37b24d"),
                    Category("주거", "EXPENSE", "home", "#fcc419"),
                    Category("통신비", "EXPENSE", "phone", "#1c7ed6"),
                    Category("수도광열비", "EXPENSE", "receipt", "#e8590c"),
                    Category("세금", "EXPENSE", "landmark", "#495057"),
                    Category("구독", "EXPENSE", "repeat", "#862e9c"),
                    Category("렌탈", "EXPENSE", "key", "#5c7cfa"),
                    Category("생활/잡화", "EXPENSE", "shopping-cart", "#cc5de8"),
                    Category("병원/약국", "EXPENSE", "heart-pulse", "#20c997"),
                    Category("문화/여가", "EXPENSE", "gamepad-2", "#f06595"),
                    Category("교육/학습", "EXPENSE", "graduation-cap", "#748ffc"),
                    Category("경조사/용돈", "EXPENSE", "gift", "#ff922b"),
                    Category("페이류", "EXPENSE", "wallet", "#0ca678"),
                    Category("이체/송금", "EXPENSE", "arrow-left-right", "#7950f2"),
                    Category("저축/투자", "EXPENSE", "trending-up", "#12b886"),
                    Category("투자", "EXPENSE", "trending-up", "#087f5b"),
                    Category("보험", "EXPENSE", "shield", "#1864ab"),
                    Category("대출상환", "EXPENSE", "landmark", "#e03131"),
                    Category("ATM/출금", "EXPENSE", "download", "#495057"),
                    Category("기부금", "EXPENSE", "heart", "#e64980"),
                    Category("기타", "EXPENSE", "more-horizontal", "#868e96"),
                    Category("월급", "INCOME", "banknote", "#10b981"),
                    Category("부수입", "INCOME", "coins", "#06b6d4"),
                    Category("용돈(수입)", "INCOME", "gift", "#8b5cf6"),
                    Category("이체/입금", "INCOME", "arrow-left-right", "#228be6"),
                    Category("ATM/입금", "INCOME", "upload", "#15aabf"),
                    Category("기타수입", "INCOME", "plus-circle", "#64748b"),
                    Category("연금", "INCOME", "piggy-bank", "#fab005"),
                    Category("지원금/환급금", "INCOME", "gift", "#be4bdb")
                )
                categoryDao.insertCategories(categories)
            }

            // 2. Seed Pay Methods if empty
            if (payMethodDao.getAllPayMethods().isEmpty()) {
                val payMethods = listOf(
                    PayMethod("현금", "CARD"),
                    PayMethod("계좌이체", "BANK"),
                    PayMethod("삼성페이", "CARD"),
                    PayMethod("국민은행", "BANK"),
                    PayMethod("신한은행", "BANK"),
                    PayMethod("우리은행", "BANK"),
                    PayMethod("하나은행", "BANK"),
                    PayMethod("농협은행", "BANK"),
                    PayMethod("기업은행", "BANK"),
                    PayMethod("케이뱅크", "BANK"),
                    PayMethod("수협은행", "BANK"),
                    PayMethod("산업은행", "BANK"),
                    PayMethod("부산은행", "BANK"),
                    PayMethod("대구은행", "BANK"),
                    PayMethod("경남은행", "BANK"),
                    PayMethod("광주은행", "BANK"),
                    PayMethod("전북은행", "BANK"),
                    PayMethod("제주은행", "BANK"),
                    PayMethod("카카오뱅크", "BANK"),
                    PayMethod("토스뱅크", "BANK"),
                    PayMethod("우체국", "BANK"),
                    PayMethod("새마을금고", "BANK"),
                    PayMethod("신협", "BANK"),
                    PayMethod("상호저축은행", "BANK"),
                    PayMethod("산림조합", "BANK"),
                    PayMethod("KB국민카드", "CARD"),
                    PayMethod("신한카드", "CARD"),
                    PayMethod("삼성카드", "CARD"),
                    PayMethod("현대카드", "CARD"),
                    PayMethod("롯데카드", "CARD"),
                    PayMethod("하나카드", "CARD"),
                    PayMethod("우리카드", "CARD"),
                    PayMethod("NH농협카드", "CARD"),
                    PayMethod("BC카드", "CARD"),
                    PayMethod("토스", "CARD")
                )
                payMethodDao.insertPayMethods(payMethods)
            }

            // 3. Seed Rules if empty
            if (ruleDao.getAllRules().isEmpty()) {
                val rules = listOf(
                    Rule(
                        name = "카드 승인 예제 규칙",
                        pattern = """\[(?<card>[^\]]+)\]\s*(?<time>\d{2}/\d{2}\s+\d{2}:\d{2})\s+(?<amount>[\d,]+)원\s+(?<merchant>.+?)\s+승인""",
                        category = "외식비",
                        payMethod = "KB국민카드",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "핀테크 간편결제",
                        pattern = """\[₩(?<amount>[\d,]+)\s*결제\s*완료\]\s*(?<merchant>.+)""",
                        category = "기타",
                        payMethod = "토스",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "하나카드 다중행 승인",
                        pattern = """\[하나카드\]\s*\[Web발신\](?:\(광고\))?\s*금액\s*(?<amount>[\d,]+)원.+?카드\s*(?<pay_method>[^\n]+).+?사용처\s*(?<merchant>[^\n]+).+?거래시간\s*(?<time>\d{2}/\d{2}\s+\d{2}:\d{2})""",
                        category = "기타",
                        payMethod = "하나카드",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "하나은행 다중행 거래",
                        pattern = """\[하나은행\]\s*\[Web발신\]\s*하나[ ,](?<time>\d{2}/\d{2}[, ]\d{2}:\d{2})\n(?<account>[\d*]+)\n(?<type_text>출금|입금)\s*(?<amount>[\d,]+)원\n(?<merchant>[^\n]+)\n잔액\s*(?<balance>[\d,]+)원""",
                        category = "기타",
                        payMethod = "하나은행",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "하나카드 지원금 차감",
                        pattern = """\[하나카드\].+?고유가\s*피해지원금.+?지원금\s*사용금액:\s*(?<amount>[\d,]+)원.+?사용일자:\s*(?<time>\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}).+?사용처:\s*(?<merchant>[^\n]+)""",
                        category = "지원금/환급금",
                        payMethod = "하나카드",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "계좌 입출금 알림",
                        pattern = """\[(?<type_text>입금|출금)\s*(?<amount>[\d,]+)원\].+?(?<time>\d{2}/\d{2}\s+\d{2}:\d{2})\s+(?<account>[\d*-]+)\s+(?<merchant>[^\s]+)\s+(?:스마트폰출금|전자금융입금|전자금융|계좌이체|창구송금)?\s*[\d,]+\s+잔액(?<balance>[\d,]+)""",
                        category = "기타",
                        payMethod = "계좌이체",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "일반 계좌 입출금 단독",
                        pattern = """(?<type_text>출금|입금)\s*(?<amount>[\d,]+)원\s*(?<merchant>[^\n\s]+)\s+잔액\s*(?<balance>[\d,]+)원\n(?<time>\d{2}/\d{2}\s+\d{2}:\d{2})\s+(?<account>[\d*\-(구)]+)""",
                        category = "기타",
                        payMethod = "계좌이체",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "괄호결제 승인 알림",
                        pattern = """\(결제\)\s*(?<amount>[\d,]+)원\s*(?<merchant>[^/\n]+?)\s*/\s*(?<pay_method>[^\(]+)\((?<pay_type>[^\)]+)\)\s*/\s*(?<time>\d{2}\.\d{2}\s+\d{2}:\d{2})(?:\s*/\s*누적.+)?""",
                        category = "기타",
                        payMethod = "카드",
                        merchantTemplate = """${'$'}{merchant}""",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "결제대금 출금 알림",
                        pattern = """\[결제일\s*출금내역\s*안내\]\s*(?<merchant>[가-힣*]+)\s*님\s*(?<time>\d{2}월\s*\d{2}일)\s*결제대금\s*(?<amount>[\d,]+)원이\s*(?<type_text>출금)되었습니다""",
                        category = "대출상환",
                        payMethod = "계좌이체",
                        merchantTemplate = "카드대금 결제",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "카드 선결제 알림",
                        pattern = """\[선결제\s*알림\]\s*(?<user>[가-힣*]+)\s*님\s*(?<time>\d{2}월\s*\d{2}일)\s*(?<pay_method>[^\s\(]+)(?:\([^\)]+\))?\s*계좌에서\s*(?<amount>[\d,]+)원이\s*(?<type_text>선결제)\s*되었습니다""",
                        category = "대출상환",
                        payMethod = "계좌이체",
                        merchantTemplate = "카드 선결제",
                        type = "EXPENSE"
                    ),
                    Rule(
                        name = "서울아리수본부 수도요금 자동납부",
                        pattern = """\[서울아리수본부\].+?(?<merchant>수도요금)\s*(?<amount>[\d,]+)원이\s*(?<pay_method>[^\(]+)\(.+?출금되었습니다.+?\[\s*출금일자\s*:\s*(?<time>\d{4}년\s*\d{2}월\s*\d{2}일)\s*\]""",
                        category = "수도광열비",
                        payMethod = "계좌이체",
                        merchantTemplate = "서울아리수본부 수도요금",
                        type = "EXPENSE"
                    )
                )
                rules.forEach { ruleDao.insertRule(it) }
            }

            // Seed Pass Rules if empty
            if (passRuleDao.getAllPassRules().isEmpty()) {
                val passRules = listOf(
                    PassRule(name = "잔액부족 거절", pattern = """잔액\s*부족|잔액\s*초과"""),
                    PassRule(name = "한도초과 거절", pattern = """한도\s*초과"""),
                    PassRule(name = "승인거절 및 오류", pattern = """승인\s*거절|출금\s*거절|결제\s*실패|오류"""),
                    PassRule(name = "인증번호 알림", pattern = """인증\s*번호|본인\s*확인"""),
                    PassRule(name = "광고/스팸", pattern = """\(광고\)|\[광고\]"""),
                    PassRule(name = "투자/주식 체결 알림", pattern = """한국투자증권 체결안내|결산분배금 입금|퇴직연금 ETF|ETF 결산분배금|채권이자 입금|디폴트옵션|구매 성공|구매했어요|자동매수체결"""),
                    PassRule(name = "선거/스팸", pattern = """선거운동정보|후보"""),
                    PassRule(name = "청구 요금 알림", pattern = """이용요금알리미|명세서|이용요금\s*안내"""),
                    PassRule(name = "안내 및 고지서", pattern = """카드대금\s*[\d,]+원|안내사항|하락\s*마감하였습니다|자동이체\s*등록\s*안내|자동납부\s*요금\s*정상승인\s*안내"""),
                    PassRule(name = "패키지명 단독", pattern = """^[a-zA-Z0-9\.]+$""")
                )
                passRules.forEach { passRuleDao.insertPassRule(it) }
            }

            // 4. Seed Franchise Presets if empty
            if (merchantCategoryDao.getAllMerchantCategories().isEmpty()) {
                val presetItems = FranchisePresets.loadPresets(context)
                val presets = presetItems.map {
                    MerchantCategory(merchant = it.keyword, category = it.category)
                }
                merchantCategoryDao.insertMerchantCategories(presets)
            }
        }
    }
}
