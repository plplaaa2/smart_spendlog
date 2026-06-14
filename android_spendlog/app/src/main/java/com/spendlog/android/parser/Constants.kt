package com.spendlog.android.parser

/**
 * [Constants.kt]
 * - 요약: 알림 메시지 파싱 및 보정에 사용되는 카드사/은행명 매핑 및 글로벌 브랜드 한글 명칭 등의 정적 매핑 데이터를 정의하는 파일입니다.
 * - 연결된 파일 목록:
 *   - BrandMapper.kt (영문 브랜드 한글명 병기)
 *   - PaymentResolver.kt (체크카드 잔액 계좌이체 변환 및 결제 수단 확인)
 *   - NotificationParser.kt (메인 파싱 진입점)
 */
object Constants {
    val BRAND_MAP = mapOf(
        "VIPS" to "빕스",
        "STARBUCKS" to "스타벅스",
        "MCDONALD" to "맥도날드",
        "BURGER KING" to "버거킹",
        "BURGERKING" to "버거킹",
        "SUBWAY" to "써브웨이",
        "SHAKE SHACK" to "쉐이크쑉",
        "FIVE GUYS" to "파이브가이즈",
        "PIZZA HUT" to "피자헛",
        "DOMINO" to "도미노",
        "PAPA JOHN" to "파파존스",
        "OUTBACK" to "아웃백",
        "DUNKIN" to "던킨",
        "SMOOTHIE KING" to "스무디킹",
        "BLUE BOTTLE" to "블루보틀",
        "7-ELEVEN" to "세븐일레븐",
        "7ELEVEN" to "세븐일레븐",
        "MINISTOP" to "미니스톱",
        "E-MART" to "이마트",
        "HOMEPLUS" to "홈플러스",
        "COSTCO" to "코스트코",
        "TRADERS" to "트레이더스",
        "DAISO" to "다이소",
        "IKEA" to "이케아",
        "COUPANG" to "쿠팡",
        "AUCTION" to "옥션",
        "AMAZON" to "아마존",
        "ALIEXPRESS" to "알리익스프레스",
        "TEMU" to "테무",
        "SHEIN" to "쉬인",
        "UNIQLO" to "유니클로",
        "ZARA" to "자라",
        "8SECONDS" to "에잇세컨즈",
        "NIKE" to "나이키",
        "ADIDAS" to "아디다스",
        "NEW BALANCE" to "뉴발란스",
        "THE NORTH FACE" to "노스페이스",
        "POLO" to "폴로",
        "MUSINSA" to "무신사",
        "UBER" to "우버",
        "NETFLIX" to "넷플릭스",
        "SPOTIFY" to "스포티파이",
        "STEAM" to "스팀",
        "PLAYSTATION" to "플레이스테이션",
        "UDEMY" to "유데미",
        "COURSERA" to "코세라"
    )

    val CARD_TO_BANK_MAP = mapOf(
        "KB국민카드" to "국민은행",
        "국민카드" to "국민은행",
        "KB국민체크카드" to "국민은행",
        "국민체크카드" to "국민은행",
        "신한카드" to "신한은행",
        "신한체크카드" to "신한은행",
        "하나카드" to "하나은행",
        "하나체크카드" to "하나은행",
        "우리카드" to "우리은행",
        "우리체크카드" to "우리은행",
        "NH농협카드" to "농협은행",
        "농협카드" to "농협은행",
        "NH농협체크카드" to "농협은행",
        "농협체크카드" to "농협은행",
        "토스" to "토스뱅크",
        "토스카드" to "토스뱅크",
        "토스체크카드" to "토스뱅크",
        "카카오" to "카카오뱅크",
        "카카오카드" to "카카오뱅크",
        "카카오체크카드" to "카카오뱅크",
        "케이뱅크카드" to "케이뱅크",
        "BC카드" to "계좌이체",
        "BC체크카드" to "계좌이체",
        "삼성카드" to "계좌이체",
        "삼성체크카드" to "계좌이체",
        "현대카드" to "계좌이체",
        "현대체크카드" to "계좌이체",
        "롯데카드" to "계좌이체",
        "롯데체크카드" to "계좌이체"
    )

    val BANK_HINTS = mapOf(
        "국민" to "국민은행",
        "KB국민" to "국민은행",
        "신한" to "신한은행",
        "우리" to "우리은행",
        "하나" to "하나은행",
        "농협" to "농협은행",
        "NH" to "농협은행",
        "기업" to "기업은행",
        "IBK" to "기업은행",
        "우체국" to "우체국",
        "새마을" to "새마을금고",
        "신협" to "신협",
        "수협" to "수협은행",
        "대구" to "대구은행",
        "부산" to "부산은행",
        "광주" to "광주은행",
        "전북" to "전북은행",
        "경남" to "경남은행",
        "제주" to "제주은행",
        "카카오" to "카카오뱅크",
        "토스" to "토스뱅크",
        "케이" to "케이뱅크",
        "K뱅크" to "케이뱅크"
    )
}
