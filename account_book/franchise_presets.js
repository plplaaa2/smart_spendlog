// franchise_presets.js
// 요약: 한국 유명 프랜차이즈 브랜드명 키워드와 카테고리를 자동 매칭하기 위한 프리셋 데이터입니다.
// 의존성: database.js의 seedDefaultData()에서 merchant_categories 테이블 초기 시딩 시 사용합니다.
//         index.js의 웹훅 파싱 단계에서 부분 일치(LIKE) 검색에도 활용됩니다.
//
// ※ 매칭 방식: merchant 값에 keyword가 포함(LIKE '%keyword%')되는 경우 해당 category로 자동 분류합니다.
//    이미 사용자가 직접 등록한 정확한 사용처명(exact match)이 있으면 그것을 우선합니다.
//
// 카테고리 분류 기준:
//   - 음료/카페  : 커피, 음료, 카페, 버블티 전문 브랜드
//   - 배달음식   : 배달 플랫폼 앱 (배달의민족, 쿠팡이츠, 요기요 등)
//   - 식비       : 음식점, 패스트푸드, 치킨, 편의점 등 직접 구매 음식

const FRANCHISE_PRESETS = [
  // =============================================
  // 디저트 - 베이커리/디저트/아이스크림 전문 브랜드
  // =============================================
  { keyword: '배스킨라빈스', category: '디저트' },
  { keyword: '베스킨라빈스', category: '디저트' },
  { keyword: '설빙', category: '디저트' },
  { keyword: '파리바게뜨', category: '디저트' },
  { keyword: '파리바게트', category: '디저트' },
  { keyword: '뚜레쥬르', category: '디저트' },
  { keyword: '던킨', category: '디저트' },
  { keyword: 'DUNKIN', category: '디저트' },
  { keyword: '크리스피크림', category: '디저트' },
  { keyword: '와플대학', category: '디저트' },
  { keyword: '성심당', category: '디저트' },
  { keyword: '이성당', category: '디저트' },
  { keyword: '삼송빵집', category: '디저트' },
  { keyword: '나뚜루', category: '디저트' },
  { keyword: '요아정', category: '디저트' },
  { keyword: '탕후루', category: '디저트' },
  { keyword: '홍루이젠', category: '디저트' },
  { keyword: '스트릿츄러스', category: '디저트' },
  { keyword: '앤티앤스', category: '디저트' },
  { keyword: '디저트39', category: '디저트' },

  // =============================================
  // 음료/카페 - 카페/음료 전문 브랜드
  // =============================================
  { keyword: '스타벅스', category: '음료/카페' },
  { keyword: 'STARBUCKS', category: '음료/카페' },
  { keyword: '투썸플레이스', category: '음료/카페' },
  { keyword: '투썸', category: '음료/카페' },
  { keyword: '이디야', category: '음료/카페' },
  { keyword: '빽다방', category: '음료/카페' },
  { keyword: '메가커피', category: '음료/카페' },
  { keyword: '컴포즈커피', category: '음료/카페' },
  { keyword: '할리스', category: '음료/카페' },
  { keyword: '커피빈', category: '음료/카페' },
  { keyword: '폴바셋', category: '음료/카페' },
  { keyword: '파스쿠찌', category: '음료/카페' },
  { keyword: '공차', category: '음료/카페' },
  { keyword: '더벤티', category: '음료/카페' },
  { keyword: '달콤커피', category: '음료/카페' },
  { keyword: '카페베네', category: '음료/카페' },
  { keyword: '탐앤탐스', category: '음료/카페' },
  { keyword: '엔제리너스', category: '음료/카페' },
  { keyword: '쥬씨', category: '음료/카페' },
  { keyword: '스무디킹', category: '음료/카페' },
  { keyword: 'SMOOTHIE KING', category: '음료/카페' },
  { keyword: '공방커피', category: '음료/카페' },
  { keyword: '블루보틀', category: '음료/카페' },
  { keyword: 'BLUE BOTTLE', category: '음료/카페' },
  { keyword: '루이보스', category: '음료/카페' },
  { keyword: '빈브라더스', category: '음료/카페' },

  // =============================================
  // 배달음식 - 배달 플랫폼 앱
  // =============================================
  { keyword: '배달의민족', category: '배달음식' },
  { keyword: '배민', category: '배달음식' },
  { keyword: '쿠팡이츠', category: '배달음식' },
  { keyword: '요기요', category: '배달음식' },

  // =============================================
  // 식비 - 패스트푸드/버거
  // =============================================
  { keyword: '맥도날드', category: '식비' },
  { keyword: 'MCDONALD', category: '식비' },
  { keyword: '버거킹', category: '식비' },
  { keyword: 'BURGER KING', category: '식비' },
  { keyword: 'BURGERKING', category: '식비' },
  { keyword: '롯데리아', category: '식비' },
  { keyword: 'KFC', category: '식비' },
  { keyword: '맘스터치', category: '식비' },
  { keyword: '노브랜드버거', category: '식비' },
  { keyword: '써브웨이', category: '식비' },
  { keyword: '서브웨이', category: '식비' },
  { keyword: 'SUBWAY', category: '식비' },
  { keyword: '쉐이크쉑', category: '식비' },
  { keyword: 'SHAKE SHACK', category: '식비' },
  { keyword: '파이브가이즈', category: '식비' },
  { keyword: 'FIVE GUYS', category: '식비' },

  // =============================================
  // 식비 - 치킨/피자
  // =============================================
  { keyword: '피자헛', category: '식비' },
  { keyword: 'PIZZA HUT', category: '식비' },
  { keyword: '도미노', category: '식비' },
  { keyword: 'DOMINO', category: '식비' },
  { keyword: '파파존스', category: '식비' },
  { keyword: 'PAPA JOHN', category: '식비' },
  { keyword: '미스터피자', category: '식비' },
  { keyword: 'BBQ', category: '식비' },
  { keyword: 'BHC', category: '식비' },
  { keyword: '교촌', category: '식비' },
  { keyword: '굽네치킨', category: '식비' },
  { keyword: '네네치킨', category: '식비' },
  { keyword: '처갓집', category: '식비' },
  { keyword: '60계치킨', category: '식비' },
  { keyword: '페리카나', category: '식비' },
  { keyword: '또래오래', category: '식비' },
  { keyword: '호식이두마리치킨', category: '식비' },

  // =============================================
  // 식비 - 한식/분식/중식/일식
  // =============================================
  { keyword: '본죽', category: '식비' },
  { keyword: '본도시락', category: '식비' },
  { keyword: '원할머니', category: '식비' },
  { keyword: '김가네', category: '식비' },
  { keyword: '고봉민김밥', category: '식비' },
  { keyword: '바르다김선생', category: '식비' },
  { keyword: '한솥', category: '식비' },
  { keyword: '이삭토스트', category: '식비' },
  { keyword: '빕스', category: '식비' },
  { keyword: 'VIPS', category: '식비' },
  { keyword: '아웃백', category: '식비' },
  { keyword: 'OUTBACK', category: '식비' },
  { keyword: 'TGI', category: '식비' },
  { keyword: '애슐리', category: '식비' },
  { keyword: '청담순두부', category: '식비' },
  { keyword: '신전떡볶이', category: '식비' },
  { keyword: '죠스떡볶이', category: '식비' },
  { keyword: '엽기떡볶이', category: '식비' },
  { keyword: '국대떡볶이', category: '식비' },

  // =============================================
  // 편의점 - 편의점 브랜드
  // =============================================
  { keyword: 'GS25', category: '편의점' },
  { keyword: 'CU편의점', category: '편의점' },
  { keyword: '세븐일레븐', category: '편의점' },
  { keyword: '7-ELEVEN', category: '편의점' },
  { keyword: '7ELEVEN', category: '편의점' },
  { keyword: '이마트24', category: '편의점' },
  { keyword: 'MINISTOP', category: '편의점' },
  { keyword: '미니스톱', category: '편의점' },

  // =============================================
  // 생활/마트 - 대형마트
  // =============================================
  { keyword: '이마트', category: '생활/마트' },
  { keyword: 'E-MART', category: '생활/마트' },
  { keyword: '홈플러스', category: '생활/마트' },
  { keyword: 'HOMEPLUS', category: '생활/마트' },
  { keyword: '롯데마트', category: '생활/마트' },
  { keyword: '코스트코', category: '생활/마트' },
  { keyword: 'COSTCO', category: '생활/마트' },
  { keyword: '트레이더스', category: '생활/마트' },
  { keyword: 'TRADERS', category: '생활/마트' },
  { keyword: '하나로마트', category: '생활/마트' },

  // =============================================
  // 생활/마트 - 생활용품
  // =============================================
  { keyword: '다이소', category: '생활/마트' },
  { keyword: 'DAISO', category: '생활/마트' },
  { keyword: '이케아', category: '생활/마트' },
  { keyword: 'IKEA', category: '생활/마트' },
  { keyword: '버터', category: '생활/마트' },

  // =============================================
  // 병원/약국 - 의원/약국/클리닉
  // =============================================
  { keyword: '올리브영', category: '병원/약국' },
  { keyword: 'OLIVE YOUNG', category: '병원/약국' },
  { keyword: '올영', category: '병원/약국' },
  { keyword: '롭스', category: '병원/약국' },
  { keyword: '드럭스토어', category: '병원/약국' },
  { keyword: '온누리약국', category: '병원/약국' },
  { keyword: '메디팜', category: '병원/약국' },
  { keyword: '클리닉', category: '병원/약국' },
  { keyword: 'CLINIC', category: '병원/약국' },
  { keyword: '병원', category: '병원/약국' },
  { keyword: '의원', category: '병원/약국' },
  { keyword: '치과', category: '병원/약국' },
  { keyword: '한의원', category: '병원/약국' },
  { keyword: '약국', category: '병원/약국' },
  { keyword: '내과', category: '병원/약국' },
  { keyword: '소아과', category: '병원/약국' },
  { keyword: '이비인후과', category: '병원/약국' },
  { keyword: '피부과', category: '병원/약국' },
  { keyword: '안과', category: '병원/약국' },
  { keyword: '정형외과', category: '병원/약국' },
  { keyword: '외과', category: '병원/약국' },
  { keyword: '팜클', category: '병원/약국' },

  // =============================================
  // 쇼핑 - 온라인몰
  // =============================================
  { keyword: '쿠팡', category: '쇼핑' },
  { keyword: 'COUPANG', category: '쇼핑' },
  { keyword: '11번가', category: '쇼핑' },
  { keyword: 'G마켓', category: '쇼핑' },
  { keyword: '지마켓', category: '쇼핑' },
  { keyword: '옥션', category: '쇼핑' },
  { keyword: 'AUCTION', category: '쇼핑' },
  { keyword: '위메프', category: '쇼핑' },
  { keyword: '티몬', category: '쇼핑' },
  { keyword: '인터파크', category: '쇼핑' },
  { keyword: '네이버쇼핑', category: '쇼핑' },
  { keyword: '카카오쇼핑', category: '쇼핑' },
  { keyword: '무신사', category: '쇼핑' },
  { keyword: '에이블리', category: '쇼핑' },
  { keyword: '지그재그', category: '쇼핑' },
  { keyword: '브랜디', category: '쇼핑' },
  { keyword: '오늘의집', category: '쇼핑' },
  { keyword: '마켓컬리', category: '쇼핑' },
  { keyword: '컬리', category: '쇼핑' },
  { keyword: '배민쇼핑', category: '쇼핑' },
  { keyword: '아마존', category: '쇼핑' },
  { keyword: 'AMAZON', category: '쇼핑' },
  { keyword: '알리바바', category: '쇼핑' },
  { keyword: '알리익스프레스', category: '쇼핑' },
  { keyword: 'ALIEXPRESS', category: '쇼핑' },
  { keyword: '테무', category: '쇼핑' },
  { keyword: 'TEMU', category: '쇼핑' },
  { keyword: '쉬인', category: '쇼핑' },
  { keyword: 'SHEIN', category: '쇼핑' },

  // =============================================
  // 패션/의류 - 패션/의류/아웃도어 브랜드
  // =============================================
  { keyword: '유니클로', category: '패션/의류' },
  { keyword: 'UNIQLO', category: '패션/의류' },
  { keyword: 'H&M', category: '패션/의류' },
  { keyword: '자라', category: '패션/의류' },
  { keyword: 'ZARA', category: '패션/의류' },
  { keyword: '스파오', category: '패션/의류' },
  { keyword: '탑텐', category: '패션/의류' },
  { keyword: '8SECONDS', category: '패션/의류' },
  { keyword: '에잇세컨즈', category: '패션/의류' },
  { keyword: '나이키', category: '패션/의류' },
  { keyword: 'NIKE', category: '패션/의류' },
  { keyword: '아디다스', category: '패션/의류' },
  { keyword: 'ADIDAS', category: '패션/의류' },
  { keyword: '뉴발란스', category: '패션/의류' },
  { keyword: 'NEW BALANCE', category: '패션/의류' },
  { keyword: '아이더', category: '패션/의류' },
  { keyword: '네파', category: '패션/의류' },
  { keyword: '블랙야크', category: '패션/의류' },
  { keyword: '노스페이스', category: '패션/의류' },
  { keyword: 'THE NORTH FACE', category: '패션/의류' },
  { keyword: '코오롱스포츠', category: '패션/의류' },
  { keyword: '밀레', category: '패션/의류' },
  { keyword: '빈폴', category: '패션/의류' },
  { keyword: '헤지스', category: '패션/의류' },
  { keyword: '폴로', category: '패션/의류' },
  { keyword: 'POLO', category: '패션/의류' },
  { keyword: '무신사', category: '패션/의류' },
  { keyword: 'MUSINSA', category: '패션/의류' },

  // =============================================
  // 교통
  // =============================================
  { keyword: '카카오택시', category: '교통' },
  { keyword: '카카오T', category: '교통' },
  { keyword: 'KAKAOT', category: '교통' },
  { keyword: '우버', category: '교통' },
  { keyword: 'UBER', category: '교통' },
  { keyword: '타다', category: '교통' },
  { keyword: '코레일', category: '교통' },
  { keyword: 'KORAIL', category: '교통' },
  { keyword: 'KTX', category: '교통' },
  { keyword: 'SRT', category: '교통' },
  { keyword: '고속버스', category: '교통' },
  { keyword: '시외버스', category: '교통' },
  { keyword: '티머니', category: '교통' },
  { keyword: 'T-MONEY', category: '교통' },
  { keyword: '따릉이', category: '교통' },
  { keyword: '쏘카', category: '교통' },
  { keyword: '그린카', category: '교통' },
  { keyword: '제주항공', category: '교통' },
  { keyword: '진에어', category: '교통' },
  { keyword: '티웨이', category: '교통' },
  { keyword: '에어부산', category: '교통' },
  { keyword: '이스타항공', category: '교통' },
  { keyword: '대한항공', category: '교통' },
  { keyword: '아시아나', category: '교통' },

  // =============================================
  // 주거/통신
  // =============================================
  { keyword: 'SKT', category: '주거/통신' },
  { keyword: 'KT', category: '주거/통신' },
  { keyword: 'LGU+', category: '주거/통신' },
  { keyword: 'LG유플러스', category: '주거/통신' },
  { keyword: '알뜰폰', category: '주거/통신' },
  { keyword: '넷플릭스', category: '주거/통신' },
  { keyword: 'NETFLIX', category: '주거/통신' },
  { keyword: '왓챠', category: '주거/통신' },
  { keyword: '웨이브', category: '주거/통신' },
  { keyword: '시즌', category: '주거/통신' },
  { keyword: '티빙', category: '주거/통신' },
  { keyword: '디즈니플러스', category: '주거/통신' },
  { keyword: 'DISNEY+', category: '주거/통신' },
  { keyword: '유튜브프리미엄', category: '주거/통신' },
  { keyword: 'YOUTUBE', category: '주거/통신' },
  { keyword: '애플뮤직', category: '주거/통신' },
  { keyword: '멜론', category: '주거/통신' },
  { keyword: '지니뮤직', category: '주거/통신' },
  { keyword: '스포티파이', category: '주거/통신' },
  { keyword: 'SPOTIFY', category: '주거/통신' },
  { keyword: '한국전력', category: '주거/통신' },
  { keyword: '한전', category: '주거/통신' },
  { keyword: '도시가스', category: '주거/통신' },
  { keyword: '수도요금', category: '주거/통신' },

  // =============================================
  // 문화/여가
  // =============================================
  { keyword: 'CGV', category: '문화/여가' },
  { keyword: '롯데시네마', category: '문화/여가' },
  { keyword: '메가박스', category: '문화/여가' },
  { keyword: '스크린X', category: '문화/여가' },
  { keyword: '카카오게임', category: '문화/여가' },
  { keyword: '넥슨', category: '문화/여가' },
  { keyword: 'NEXON', category: '문화/여가' },
  { keyword: '넷마블', category: '문화/여가' },
  { keyword: 'NC소프트', category: '문화/여가' },
  { keyword: '크래프톤', category: '문화/여가' },
  { keyword: '스팀', category: '문화/여가' },
  { keyword: 'STEAM', category: '문화/여가' },
  { keyword: '플레이스테이션', category: '문화/여가' },
  { keyword: 'PLAYSTATION', category: '문화/여가' },
  { keyword: '에픽게임즈', category: '문화/여가' },
  { keyword: '교보문고', category: '문화/여가' },
  { keyword: '예스24', category: '문화/여가' },
  { keyword: '알라딘', category: '문화/여가' },
  { keyword: '인터파크도서', category: '문화/여가' },
  { keyword: '밀리의서재', category: '문화/여가' },
  { keyword: '리디', category: '문화/여가' },
  { keyword: '카카오페이지', category: '문화/여가' },
  { keyword: '네이버시리즈', category: '문화/여가' },
  { keyword: '나이키런', category: '문화/여가' },
  { keyword: '헬스장', category: '문화/여가' },
  { keyword: '피트니스', category: '문화/여가' },
  { keyword: '짐', category: '문화/여가' }, // GYM

  // =============================================
  // 교육/학습
  // =============================================
  { keyword: '클래스101', category: '교육/학습' },
  { keyword: '클래스유', category: '교육/학습' },
  { keyword: '탈잉', category: '교육/학습' },
  { keyword: '패스트캠퍼스', category: '교육/학습' },
  { keyword: '인프런', category: '교육/학습' },
  { keyword: '유데미', category: '교육/학습' },
  { keyword: 'UDEMY', category: '교육/학습' },
  { keyword: '코세라', category: '교육/학습' },
  { keyword: 'COURSERA', category: '교육/학습' },
  { keyword: '해커스', category: '교육/학습' },
  { keyword: '에듀윌', category: '교육/학습' },
  { keyword: '이투스', category: '교육/학습' },
  { keyword: '메가스터디', category: '교육/학습' },
  { keyword: '대성마이맥', category: '교육/학습' },
  { keyword: '공단기', category: '교육/학습' },
  { keyword: '사이버대', category: '교육/학습' },
];

module.exports = { FRANCHISE_PRESETS };
