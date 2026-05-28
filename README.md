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
- **대시보드**: 월 예산 대비 지출률, 결제 수단별 월 목표 실적 달성률(게이지 바), 현금/은행 잔액 및 카드 누적 사용액을 실시간으로 출력합니다.
- **거래 내역 관리**: 조회 기간, 카테고리, 결제 수단별 상세 필터링 기능을 탑재하였으며 개별 내역의 수동 추가, 수정 및 삭제가 가능합니다.
- **소비 트렌드 분석**:
  - **일반 분석**: 최근 6개월 소비 흐름 차트, 카테고리별 비중 도넛 차트, 일자별 추이 차트를 제공합니다.
  - **연간 분석**: 전년 동월 대비 카테고리별 소비 증감 비교 테이블(천원 단위 축소) 및 최근 12개월 월별 흐름 차트를 출력합니다.
  - **고정지출 분석**: 구독, 보험, 공과금, 주거/통신, 대출상환 카테고리의 고정비를 집계하고 전용 6개월 트렌드 차트와 상세 내역 리스트를 별도 탭으로 표기합니다.
- **사이드바 시계 위젯**: 현재 날짜와 실시간 시계를 UI 사이드바 영역에 탑재하였습니다.

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
├── index.js                  # 백엔드 서버 엔트리포인트 (API 및 WebSocket 핸들러)
├── tree.md                   # 프로젝트 디렉토리 트리 정보
├── changelog.jsonl           # 내부 개발 버전 관리 로그
├── caution.jsonl             # 개발 시 주의/예외 조건 기록
└── public/                   # 프론트엔드 정적 리소스
    ├── index.html            # 웹 UI 구조 정의
    ├── app.js                # 메인 UI 상태 및 공통 API 바인딩
    ├── dashboard.js          # 대시보드 데이터 바인딩 및 차트 렌더링
    ├── analytics.js          # 소비 분석/비교 차트 및 테이블 렌더링
    ├── settings.js           # 분류규칙/잔액/실적 목표 설정 UI 연동
    └── components.css        # CSS 변수 및 스타일시트 모음
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

## ☁️ 구글 드라이브 백업 설정 및 API 발급 방법

가계부 데이터를 구글 드라이브에 안전하게 자동 백업하고 복원하기 위해서는 Google Cloud Console에서 OAuth 2.0 클라이언트 자격증명(Client ID 및 Client Secret)을 발급받아야 합니다.

### 🔑 1단계: Google Cloud 프로젝트 생성 및 API 활성화
1. [Google Cloud Console](https://console.cloud.google.com/)에 접속하여 로그인합니다.
2. 상단 프로젝트 선택 메뉴에서 **새 프로젝트**를 생성합니다.
3. 왼쪽 탐색 메뉴에서 **API 및 서비스 > 라이브러리**로 이동합니다.
4. 검색창에 `Google Drive API`를 검색하고 클릭한 뒤, **사용** 버튼을 눌러 활성화합니다.

### 📝 2단계: OAuth 동의 화면 구성
1. 왼쪽 메뉴에서 **OAuth 동의 화면**을 클릭합니다.
2. User Type을 **외부 (External)**로 선택하고 **만들기**를 클릭합니다.
3. 앱 이름, 사용자 지원 이메일, 개발자 연락처 정보 등을 입력하고 **저장 후 계속**을 클릭합니다.
4. **범위 (Scopes)** 단계에서는 별도의 추가 범위 지정 없이 **저장 후 계속**을 클릭합니다.
5. **테스트 사용자 (Test Users)** 단계에서 가계부 백업을 연동할 본인의 구글 계정 이메일을 **추가**한 뒤 **저장 후 계속**을 누릅니다.

### 💳 3단계: OAuth 클라이언트 ID 자격증명 발급
1. 왼쪽 메뉴에서 **사용자 인증 정보 (Credentials)**를 클릭합니다.
2. 상단의 **+ 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**를 선택합니다.
3. 애플리케이션 유형을 **웹 애플리케이션 (Web Application)**으로 선택합니다.
4. 이름을 입력하고 하단의 **승인된 리디렉션 URI (Authorized Redirect URIs)** 항목에 다음 URI를 추가합니다:
   * **HA 실구동 환경**: `https://<본인의_HA_주소>/api/addons/api/account_book/settings/google/callback`  
     *(또는 본인의 도메인/IP 주소 규격에 맞는 인그레스 주소로 지정)*
   * **로컬 개발 환경**: `http://localhost:8124/settings/google/callback`
5. **만들기**를 누르면 팝업창으로 **클라이언트 ID**와 **클라이언트 보안 비밀번호(Client Secret)**가 생성됩니다. 이 값을 복사하여 보관합니다.

### 🔄 4단계: 가계부 앱에 설정 등록
1. 가계부 웹 UI에서 **설정 > 기본 설정 > 구글 드라이브 백업 설정**으로 이동합니다.
2. 발급받은 **Client ID**, **Client Secret**, **Redirect URI**를 정확히 입력하고 **저장**을 누릅니다.
3. **구글 계정 연동** 버튼을 클릭하여 Google OAuth 로그인을 완료하고 드라이브 권한을 승인합니다.
4. 연동이 완료되면 매일 자정에 가계부 데이터가 암호화되어 드라이브에 자동 백업되며, 수동 백업 및 복원 기능이 활성화됩니다.

---

## 💻 로컬 개발 환경 실행 방법 (Windows)

Home Assistant 컨테이너 환경이 아닌 Windows 로컬 환경에서 단독 테스트 및 개발 시 아래 절차를 수행합니다.

1. **의존성 모듈 설치**:
   ```powershell
   npm install
   ```
2. **서버 실행**:
   ```powershell
   node index.js
   ```
3. **웹 접속**: 브라우저를 열고 `http://localhost:8124`로 접속합니다.  
   *(로컬 실행 시 SQLite DB 파일은 프로젝트 루트 하위의 `data/` 디렉토리 내에 독립 자동 생성됩니다.)*

---

## ☕ 후원 (Support)

프로젝트 개발이 도움이 되셨다면 따뜻한 커피 한 잔 후원해 주세요!
- **Ko-fi**: [https://ko-fi.com/plplaaa2](https://ko-fi.com/plplaaa2)
