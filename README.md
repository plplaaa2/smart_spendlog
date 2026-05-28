# Home Assistant 가계부 Add-on (HA Account Book)

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue?style=flat-square&logo=home-assistant)](https://github.com/plplaaa2/account_book)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange?style=flat-square)](https://github.com/hacs/integration)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-lightgrey?style=flat-square)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/plplaaa2)

Home Assistant Companion 앱의 알림(카드 승인 문자, 간편결제 푸시 등) 및 Webhook 호출을 수신하여 금액, 가맹점, 결제수단, 일시를 파싱하고 SQLite 데이터베이스에 기록한 뒤 웹 대시보드로 시각화하는 통합 가계부 서비스입니다.

---

## 🛠️ 주요 기능

### 1. 데이터 수집 및 파싱 엔진
- **실시간 알림 수신**: Home Assistant Companion 앱의 `Last Notification` 센서 상태 변화를 WebSocket 연결을 통해 백그라운드에서 실시간 감시합니다.
- **Webhook API 제공**: 외부 자동화(Tasker 등) 도구 연동을 위한 웹훅 엔드포인트(`POST /api/webhook`)를 제공합니다.
- **동적 정규식 파서**: Named Capture Group(`(?<amount>...)`, `(?<merchant>...)`, `(?<time>...)` 등)을 이용해 알림 문자열로부터 지출 구성요소를 추출합니다.
- **휴리스틱(Heuristic) 분석기**: 사전에 등록된 정규식 규칙이 없더라도 문자열 유형을 파악하여 금액, 사용처, 결제방식을 자동으로 1차 추출합니다.
- **패스(PASS) 필터 규칙**: 광고, 시스템 알림 등 비금융성 알림을 필터링하여 로그 기록에서 제외합니다.
- **포인트(지원금) 차감 파싱**: 실거래 시 포인트/지원금 차감 정보(`used_point` 필드)를 파싱하여 자산 및 청구 금액에 실시간 보정 반영합니다.

### 2. 다중 계정 격리 및 보안
- **사용자별 DB 격리**: 각 로그인 계정별로 `account_book_[username].db` 형식의 독립된 SQLite DB 파일을 관리합니다.
- **토큰 기반 인증**: 로그인 완료 시 `username:token` 결합 구조의 세션 토큰을 발급하여 API 호출의 유효성을 검증합니다.
- **로그인 보안 시스템**: 로그인 5회 실패 시 15분간 해당 계정 및 요청 IP를 동시 차단(`login_security` 테이블 기록 연동)합니다.

### 3. 데이터베이스 및 자동 시딩
- **설정 파일 기반 시딩**: `default_rules.json` 파일에 정의된 카테고리, 결제수단 및 예제 규칙 데이터를 기준으로 DB 구동 시 자동 시딩 및 동기화(UPSERT)합니다.
- **가맹점 프리셋 연동**: `franchise_presets.js` 내 정의된 230개 이상의 가맹점 사전 데이터를 기반으로 가맹점별 카테고리를 자동 학습 및 재분류합니다.
- **자동 카테고리 마이그레이션**: 신규 카테고리(이체/송금, 이체/입금, 투자, 공과금, 구독, 교통/주유, 보험, 페이류, 렌탈, 온라인쇼핑, 해외직구, 대출상환)가 추가될 경우 기존 데이터베이스 스키마 및 레코드를 자동으로 병합/변경합니다.

### 4. 대시보드 및 통계 UI (반응형)
- **대시보드**: 월 예산 대비 지출률, 결제 수단별 커스텀 실적 산정 기간(시작일 기준)에 기반한 월 목표 실적 달성률(게이지 바), 현금/은행 잔액 및 카드 누적 사용액을 실시간으로 출력합니다.
- **거래 내역 관리**: 조회 기간, 카테고리, 결제 수단별 상세 필터링 기능을 탑재하였으며 개별 내역의 수동 추가, 수정 및 삭제가 가능합니다.
- **소비 트렌드 분석**:
  - **일반지출 분석**: 고정비를 제외한 변동성 지출(식비, 생활, 문화 등)만을 대상으로 최근 6개월 추이, 카테고리 비중 차트, 그리고 상세 내역 및 요약 정보를 분석합니다.
  - **연간 분석**: 전년 동월 대비 카테고리별 소비 증감 비교 테이블(천원 단위 축소) 및 최근 12개월 월별 흐름 차트를 출력합니다.
  - **고정지출 분석**: 구독, 보험, 공과금, 주거/통신, 대출상환 카테고리의 고정비를 집계하고 전용 6개월 트렌드 차트와 상세 내역 리스트를 별도 탭으로 표기합니다.
- **사이드바 시계 위젯**: 현재 날짜와 실시간 시계를 UI 사이드바 영역에 탑재하였으며, 사이드바 접기/펼치기 토글 기능을 지원합니다.

### 5. Home Assistant 센서 연동
- **5종 실시간 센서 생성**: `sensor.account_book_[username]_monthly_income`, `monthly_expense`, `remaining_budget`, `net_profit`, `savings` 등 총 5개 메트릭 센서를 HA Core API를 통해 실시간 업데이트합니다.
- **고아 센서 정리**: 서버 기동 시 현재 활성화되지 않은 구사용자 가계부 센서를 찾아 HA 상에서 자동 제거합니다.

---

## 📂 디렉토리 구조

```
account_book/
├── config.json               # Home Assistant Add-on 메타데이터 및 Ingress 설정
├── Dockerfile                # Alpine Node.js 기반 컨테이너 빌드 정의
├── run.sh                    # Add-on 실행 진입점 셸 스크립트
├── package.json              # Express, sqlite3, ws 의존성 정의
├── default_rules.json        # 기본 카테고리, 결제수단 및 규칙 시드 데이터
├── franchise_presets.js      # 230여 개 가맹점 키워드 및 카테고리 사전 파일
├── database.js               # SQLite 데이터베이스 마이그레이션 및 시딩 제어 모듈
├── parser.js                 # 실시간 알림 파싱 및 날짜/사용처 처리 모듈
├── crypto_helper.js          # 암호화 및 복호화 헬퍼 모듈
├── index.js                  # 백엔드 서버 엔트리포인트 (Express 웹 서비스 실행)
├── routes/                   # 기능별 라우터 분할 디렉토리
│   ├── auth.js               # 로그인/세션 관리 라우터
│   ├── transactions.js       # 거래내역 관리 API 라우터
│   ├── analytics.js          # 지출 분석/고정비 집계 API 라우터
│   ├── rules.js              # 정규식 자동 분류 규칙 API 라우터
│   ├── settings.js           # 초기 보유 자산/목표 실적/사용처 매핑 API 라우터
│   └── webhook.js            # 외부 자동화 연동 웹훅 라우터
└── public/                   # 프론트엔드 정적 리소스
    ├── index.html            # 웹 UI 마크업 구조 정의
    ├── app.js                # 메인 UI 상태, 탭 전환 및 공통 API 바인딩
    ├── dashboard.js          # 대시보드 데이터 바인딩 및 차트 렌더링
    ├── transactions.js       # 거래내역 조회, 수동 추가/수정/삭제 바인딩
    ├── analysis.js           # 통합 소비 분석 및 차트 렌더링
    ├── variables.css         # CSS 변수 및 전역 리셋 스타일
    ├── navigation.css        # 사이드바 레이아웃 및 하단 네비게이션 CSS
    ├── components.css        # 버튼, 인풋, 모달, 로그인 UI 컴포넌트 CSS
    ├── views.css             # 탭별 개별 페이지 스타일 뷰 CSS
    └── responsive.css        # 모바일 및 태블릿 미디어 쿼리 CSS
```

---

## 💾 데이터베이스 스키마 개요

SQLite 데이터베이스 파일에 생성되는 핵심 테이블 명세입니다:

| 테이블명 | 용도 | 주요 컬럼 |
| :--- | :--- | :--- |
| `categories` | 가계부 지출/수입 카테고리 마스터 | `id`, `name` (UNIQUE), `color`, `icon`, `type` |
| `pay_methods` | 결제수단(은행/카드사/페이 등) 마스터 | `id`, `name` (UNIQUE) |
| `rules` | 정규식 기반 알림 자동 분류 규칙 | `id`, `name` (UNIQUE), `pattern`, `category`, `pay_method`, `merchant_template`, `type` |
| `pass_rules` | 수신 시 가계부 기록을 스킵할 패스 필터 규칙 | `id`, `name` (UNIQUE), `pattern`, `created_at` |
| `transactions` | 입출금 거래 내역 데이터 | `id`, `type`, `amount`, `merchant`, `category`, `pay_method`, `datetime`, `memo`, `raw_text`, `used_point` |
| `notification_logs` | 수신된 날것의 스마트폰 알림 히스토리 | `id`, `sender`, `raw_text`, `title`, `text`, `parsed_status`, `matched_rule_id`, `created_at` |
| `package_pay_methods`| 발신 앱 패키지명 기준 결제수단 강제 매핑 | `id`, `package` (UNIQUE), `pay_method` |
| `merchant_categories`| 가맹점별 카테고리 매핑 캐시 및 학습 데이터 | `id`, `merchant` (UNIQUE), `category` |
| `settings` | 사용자 개인별 설정값 (예산, 초기 잔액 등) | `key` (PRIMARY KEY), `value` |
| `login_security` | IP/사용자 계정별 로그인 실패 및 차단 기록 | `target` (PRIMARY KEY), `type`, `fail_count`, `last_failed_at`, `banned_until` |

---

## ⚙️ 설치 및 설정 방법

### 1. Add-on 설치
1. `account_book` 폴더를 Home Assistant 호스트의 `/addons` 디렉토리에 복사합니다.
2. Home Assistant **설정 > 기기 및 서비스 > Add-on > 애드온 스토어** 메뉴로 이동합니다.
3. 우측 상단 옵션 메뉴에서 **'애드온 재로드'**를 실행합니다.
4. 로컬 목록에 나타난 **'HA Account Book'**을 선택한 뒤 **설치**를 진행합니다.
5. 설치 완료 후 **'사이드바에 표시'**를 켜고 **시작** 버튼을 누릅니다.

### 2. 스마트폰 알림 수집 설정
#### 방법 A: WebSocket 연동 (권장)
1. 스마트폰에 **Home Assistant 공식 Companion 앱**을 설치합니다.
2. 앱 설정 내 **센서 관리** 메뉴에서 **'마지막 알림(Last Notification)'** 센서를 활성화합니다.
3. 가계부 웹 UI 내 **설정 > 기본 설정**으로 이동하여 본인의 알림 센서 Entity ID(예: `sensor.phone_last_notification`)를 입력하고 등록합니다.

#### 방법 B: HA 자동화를 통한 웹훅(Webhook) 호출
수동으로 조건별 알림만 API를 호출해 전송하려면 아래와 같이 Home Assistant Automation을 작성합니다.

```yaml
alias: "가계부: 카드 알림 전송 자동화"
trigger:
  - platform: state
    entity_id: sensor.my_phone_last_notification
condition:
  - condition: template
    value_template: "{{ trigger.to_state.state != 'unknown' and trigger.to_state.state != 'unavailable' }}"
action:
  - service: http.post
    data:
      url: http://account_book:8124/api/webhook
      json:
        title: "{{ trigger.to_state.attributes.android.title }}"
        text: "{{ trigger.to_state.attributes.android.text }}"
```

---

## ☕ 후원 (Support)

프로젝트 개발이 도움이 되셨다면 따뜻한 커피 한 잔 후원해 주세요!
- **Ko-fi**: [https://ko-fi.com/plplaaa2](https://ko-fi.com/plplaaa2)
