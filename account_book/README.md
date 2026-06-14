# Smart Spendlog (HA Add-on)

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue?style=flat-square&logo=home-assistant)](https://github.com/plplaaa2/smart_spendlog)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-lightgrey?style=flat-square)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/plplaaa2)

Home Assistant Companion 앱의 알림(카드 승인 문자, 간편결제 푸시 등) 및 Webhook 호출을 수신하여 금액, 가맹점, 결제수단, 일시를 파싱하고 SQLite 데이터베이스에 기록한 뒤 웹 대시보드로 시각화하는 Smart Spendlog 서비스입니다.

---

## 🛠️ 주요 기능

### 1. 데이터 수집 및 파싱 엔진
- **실시간 알림 수신**: Home Assistant Companion 앱의 `Last Notification` 센서 상태 변화를 WebSocket 연결을 통해 백그라운드에서 실시간 감시합니다.
- **Webhook API 제공**: 외부 자동화(Tasker 등) 도구 연동을 위한 웹훅 엔드포인트(`POST /api/webhook`)를 제공합니다.
- **동적 정규식 파서**: Named Capture Group을 이용해 알림 문자열로부터 지출 구성요소를 추출하며, 구버전 규칙 매칭 시 발생하던 파싱 오류 보정 기능이 탑재되어 있습니다.
- **크로스플랫폼 정규식 호환 엔진 (v2.2.0 신규)**: 안드로이드 ICU 정규식 컴파일 제약(그룹명 내 언더바 사용 금지)을 극복하고자 Named Capture Group명 내 언더바(`_`) 문자를 `camelCase`로 자동 정화해 주는 `sanitizePattern` 필터를 백엔드 파서 및 라우터 전 영역에 도입하여 모바일과 백엔드 간 컴파일 호환성을 100% 보장합니다.
- **결제수단과 결제방식의 명확한 독립 분리**: 파서 및 매칭 로직에서 결제수단(카드/은행명, `payMethod`)과 결제방식(신용/체크/이체, `payType`)을 독립 필드로 완전히 분리하고, 정규식 작성 가이드 UI에도 이를 명확하게 분할 안내합니다.
- **휴리스틱(Heuristic) 분석기**: 사전에 등록된 정규식 규칙이 없더라도 문자열 유형을 파악하여 금액, 사용처, 결제방식을 자동 추출하며, 사용자가 수동 설정한 카테고리를 자동 Heuristic보다 최우선하여 결정합니다.
- **패스(PASS) 필터 규칙**: 광고, 시스템 알림 등 비금융성 알림을 필터링하여 로그 기록에서 제외합니다.
- **포인트(지원금) 차감 파싱**: 실거래 시 포인트/지원금 차감 정보(`used_point` 필드)를 파싱하여 자산 및 청구 금액에 실시간 보정 반영합니다.

### 2. 다중 계정 격리 및 외부 접속 보안
- **사용자별 DB 격리**: 각 로그인 계정별로 `account_book_[username].db` 형식의 독립된 SQLite DB 파일을 관리합니다.
- **토큰 기반 인증**: 로그인 완료 시 `username:token` 결합 구조의 세션 토큰을 발급하여 API 호출의 유효성을 검증합니다.
- **로그인 지수 대기 잠금 (Exponential Backoff)**: 무차별 대입 공격을 차단하기 위해 로그인 5회 연속 실패 시 실패 횟수 누적량에 따라 차단 대기 시간이 지수적으로 증가(15분 → 30분 → 1시간...)하며, 실패 리셋 윈도우도 점진적으로 늘려 우회를 철저히 방어합니다.
- **API 속도 제한 (Rate Limiting)**: IP 기반 Rate Limiter를 통해 API 과부하 공격을 방지합니다. 일반 API는 분당 60회, 로그인 및 웹훅과 같은 민감 API는 분당 10회로 정교하게 빈도를 제어합니다.
- **보안 HTTP 헤더 주입**: 브라우저 기반의 클릭재킹 및 CSS/XSS 인젝션 등을 방어하기 위해 OWASP 표준 보안 헤더(`X-Frame-Options`, `Content-Security-Policy`, `X-Content-Type-Options` 등)를 강제 주입합니다.

### 3. 데이터베이스 및 자동 시딩
- **설정 파일 기반 시딩**: `default_rules.json` 파일에 정의된 카테고리, 결제수단 및 예제 규칙 데이터를 기준으로 DB 구동 시 자동 시딩 및 동기화(UPSERT)합니다.
- **가맹점 프리셋 연동**: `franchise_presets.js` 내 정의된 230개 이상의 가맹점 사전 데이터를 기반으로 가맹점별 카테고리를 자동 학습 및 재분류합니다.
- **자동 카테고리 마이그레이션**: 신규 카테고리(이체/송금, 이체/입금, 투자, 공과금, 구독, 교통/주유, 보험, 페이류, 렌탈, 온라인쇼핑, 해외직구, 대출상환)가 추가될 경우 기존 데이터베이스 스키마 및 레코드를 자동으로 병합/변경합니다.

### 4. 대시보드 및 통계 UI (반응형)
- **대시보드**: 월 예산 대비 지출률, 결제 수단별 커스텀 실적 산정 기간(시작일 기준)에 기반한 월 목표 실적 달성률(게이지 바), 현금/은행 잔액 및 카드 누적 사용액을 실시간으로 출력합니다.
- **거래 내역 관리**: 조회 기간, 카테고리, 결제 수단별 상세 필터링 기능을 탑재하였으며 개별 내역의 수동 추가, 수정 및 삭제가 가능합니다.
- **소비 트렌드 분석**:
  - **일반지출 분석**: 고정비를 제외한 변동성 지출(외식비, 생활, 문화 등)만을 대상으로 최근 6개월 추이, 카테고리 비중 차트, 그리고 상세 내역 및 요약 정보를 분석합니다.
  - **연간 분석**: 전년 동월 대비 카테고리별 소비 증감 비교 테이블(천원 단위 축소) 및 최근 12개월 월별 흐름 차트를 출력합니다.
  - **고정지출 분석**: 구독, 보험, 수도광열비, 주거, 통신비, 대출상환 카테고리의 고정비를 집계하고 전용 6개월 트렌드 차트와 상세 내역 리스트를 별도 탭으로 표기합니다.
  - **AI 소비 분석 리포트 (v2.2.0)**:
    * 수집된 가계 통계 데이터를 바탕으로 지능형 AI 모델(Gemini, OpenAI, 로컬 LLM)을 연동해 심도 있는 재정 진단 피드백을 수립합니다.
    * **동적 UI 그래프 결합**: 단순 줄글을 넘어 다크 모드에 최적화된 HTML/CSS 마크업(동적 Progress Bar 및 conic-gradient 도넛형 차트) 시각화가 결합된 프리미엄 리포트를 출력합니다.
    * **마크다운 HTML 가드 보호**: 자체 마크다운 파서가 동적 그래프 스타일 코드를 `<p>` 태그로 무단 래핑해 깨뜨리던 현상을 원천 방지하고자, HTML 코드 전후의 특수 패턴 검사 강화 및 AI의 단일 행(Single Line) 응답 지침을 적용하여 렌더링 신뢰성을 대폭 향상시켰습니다.
    * **3분 통신 지연 타임아웃 보장**: 고부하 마크업 생성 시 지연으로 발생하던 HTTP 연결 유실을 방지하기 위해 생성 타임아웃 제한을 기존 60초에서 **180초(3분)**로 대폭 확대하고 로딩 대기 텍스트를 개선했습니다.
- **사이드바 시계 위젯**: 현재 날짜와 실시간 시계를 UI 사이드바 영역에 탑재하였으며, 사이드바 접기/펼치기 토글 기능을 지원합니다.
- **백업 관리 대시보드**: 로컬 디바이스에 백업된 파일들의 보관 현황을 리스트업하고, 즉각 복구 및 다이렉트 로컬 다운로드가 가능합니다.

### 5. Home Assistant 센서 연동
- **5종 실시간 센서 생성**: `sensor.account_book_[username]_monthly_income`, `monthly_expense`, `remaining_budget`, `net_profit`, `savings` 등 총 5개 메트릭 센서를 HA Core API를 통해 실시간 업데이트합니다.
- **고아 센서 정리**: 서버 기동 시 현재 활성화되지 않은 구사용자 Smart Spendlog 센서를 찾아 HA 상에서 자동 제거합니다.

---

## ⚙️ 설치 및 설정 방법

### 1. Add-on 설치

#### 방법 A: 원클릭 추가 (권장)
아래 버튼을 클릭하여 Home Assistant에 **Smart Spendlog** 저장소를 자동으로 추가하고 설치를 진행합니다.

[![Open your Home Assistant instance and show the add app repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fplplaaa2%2Fsmart_spendlog)

#### 방법 B: 수동 설치 (로컬)
1. `account_book` 폴더를 Home Assistant 호스트의 `/addons` 디렉토리에 복사합니다.
2. Home Assistant **설정 > 기기 및 서비스 > Add-on > 애드온 스토어** 메뉴로 이동합니다.
3. 우측 상단 옵션 메뉴에서 **'애드온 재로드'**를 실행합니다.
4. 로컬 목록에 나타난 **'Smart Spendlog'**를 선택한 뒤 **설치**를 진행합니다.
5. 설치 완료 후 **'사이드바에 표시'**를 켜고 **시작** 버튼을 누릅니다.

### 2. 스마트폰 알림 수집 설정

#### 방법 A: WebSocket 연동 (권장 - Android 전용)
Home Assistant 공식 앱의 **마지막 알림(Last Notification)** 센서를 활용하여 실시간으로 스마트폰 알림을 수신합니다.

1. 스마트폰에 **Home Assistant 공식 Companion 앱**을 설치하고 로그인합니다.
2. 앱 내 **설정 > 모바일 앱 > 센서 관리** 메뉴로 이동합니다.
3. **'마지막 알림(Last Notification)'** 센서를 찾아 활성화합니다. (최초 설정 시 스마트폰 시스템의 '알림 접근 허용' 권한이 필요합니다.)
4. ⚠️ **[중요] 알림 허용 앱 필터링**:
   * 기본 상태에서는 스마트폰의 모든 알림이 Home Assistant로 전송되어 불필요한 배터리 소모와 로그 누적이 발생합니다.
   * 센서 상세 설정 화면 내 **'허용 목록(Allow List)'** 또는 **'앱 필터링'** 옵션을 활성화한 뒤, 알림 수집을 원하는 **카드 승인 앱, 은행 앱, 간편결제(Toss, 삼성페이 등), 문자(SMS) 앱**만 선택하여 등록하십시오.
5. **Smart Spendlog** 웹 UI 내 **설정 > 기본 설정** 서브 탭으로 이동하여 본인의 알림 센서 Entity ID(예: `sensor.phone_last_notification`)를 입력하고 저장합니다.

#### 방법 B: HA 자동화를 통한 웹훅(Webhook) 호출
수동으로 조건별 알림만 API를 호출해 전송하려면 아래와 같이 Home Assistant Automation을 작성합니다.

```yaml
alias: "Smart Spendlog: 카드 알림 전송 자동화"
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

### 3. 데이터 백업 및 이중화 설정 방법

데이터 유실을 방지하고 불의의 장애 상황에 대응하기 위해 로컬 백업 관리 기능과 외부 네트워크 이중화 전송 설정을 제공합니다.

#### A. 로컬 자동 백업 및 복원
- **자동 백업 스케줄링**: 설정 화면 내 **자동 네트워크 백업 활성화** 옵션을 켜면 사용자가 설정한 백업 실행 시간 및 실행 요일(다중 선택 가능)에 맞추어 자동으로 백업이 실행됩니다.
- **JSON 직렬화 및 이식성**: 백업 파일이 SQLite `.db` 바이너리에서 직렬화된 `.json` 파일로 변경되어 기기 및 데이터베이스 간 데이터 이식성이 매우 높아졌습니다.
- **AES-256 암호화 보호**: 개인 가계부 정보 보안을 위해 자동 네트워크 백업 전송 파일은 서버 설정 토큰(token)을 기반으로 AES-256-CBC 암호화되어 안전하게 전송됩니다. 수동 백업 시에도 암호화 여부를 선택하여 내보낼 수 있으며, 복원 시 자동 감지되어 복호화 처리됩니다.
- **롤링 유지 정책**: 최근 7일 동안의 백업본만 보존되며, 7일이 지난 백업은 디스크 용량 확보를 위해 매일 밤 백업 시 자동 순환 삭제됩니다.
- **UI 일체형 복원 및 다운로드**: **설정 > 데이터 관리** 탭 하단의 백업 복원 카드에서 백업 파일을 업로드하여 데이터를 **즉시 복원(Restore)**하거나 브라우저를 통해 로컬 PC로 **즉시 다운로드(Download)**할 수 있습니다.
  > [!IMPORTANT]
  > 백업본 복원 실행 시 기존 DB 데이터를 모두 삭제 후 안전하게 트랜잭션 내에서 JSON 데이터를 파싱하여 주입하며, 복원 후 Home Assistant 실시간 센서 재동기화 흐름이 동적으로 일괄 진행됩니다.

#### B. 네트워크 백업 (Samba / UNC Path 공유 폴더)
- **용도**: 로컬 홈 네트워크 환경에 구성된 NAS, 타 PC 또는 삼바 공유 폴더로 백업을 즉시 복사하고자 할 때 사용합니다.
- **설정 항목**:
  1. 백업 전송 방식을 `로컬/네트워크 디렉토리 경로 (UNC/Local Path)`로 지정합니다.
  2. **네트워크 백업 경로**:
     * **윈도우 호스트**: 공유 폴더의 UNC 경로 (예: `\\192.168.1.100\Backups`)를 기입합니다.
     * **리눅스/도커 호스트**: 호스트 디바이스 상에 마운트된 로컬 경로 (예: `/share/backups`, `/media/backup`)를 입력합니다. (HA 마운트 스토리지가 있는 경우 드롭다운에서 간편 선택할 수 있습니다.)
  3. **자격 증명 (선택사항)**:
     * 공유 폴더 접근에 로그인이 필요한 경우 **공유 폴더 사용자 이름**과 **비밀번호**를 입력합니다.
     * 윈도우 환경 실행 시 백그라운드에서 임시로 해당 자격증명을 사용해 드라이브 커넥션(`net use`)을 맺고 파일을 복사한 뒤 즉시 연결을 해제(`net use /delete /y`)합니다.
     * > [!WARNING]
       > 리눅스(도커 애드온) 환경은 컨테이너 아키텍처 특성 및 특권 권한 해제로 인해 컨테이너 내에서 삼바(CIFS) 자격증명 수립/직접 마운트가 실패합니다. 따라서 리눅스 기반 환경에서는 **호스트 OS단에서 삼바를 마운트한 폴더 경로**를 지정해 단순 로컬 복사 방식으로 쓰시거나, 아래 WebDAV 프로토콜을 사용해주십시오.

#### C. WebDAV 외부 이중화 백업 (시놀로지 NAS 등)
- **용도**: 시놀로지 NAS, 외부 클라우드 등 WebDAV 통신이 활성화된 타겟 서버로 HTTPS/HTTP 외부 원격 이중화를 진행합니다.
- **설정 항목**:
  1. 백업 전송 방식을 `WebDAV 프로토콜`로 변경합니다.
  2. **WebDAV 주소(URL)**: WebDAV 서버 주소와 포트, 백업 폴더 경로가 조합된 형태를 입력합니다 (예: `https://my-synology.local:5006/webdav/Backup`).
  3. **사용자 이름 / 비밀번호**: NAS 로그인 계정 정보를 입력합니다. 패스워드는 DB 저장 시 **AES-256-CBC 알고리즘으로 즉시 양방향 암호화**되며, UI 출력 시 마스킹(`******`) 처리되어 누출이 차단됩니다.
  4. **시놀로지 NAS WebDAV 활성화 절차**:
     * 시놀로지 패키지 센터에서 `WebDAV Server` 패키지 설치.
     * WebDAV Server 앱 실행 후 HTTPS 포트(기본 5006) 혹은 HTTP 포트(기본 5005) 활성화 체크.
     * DSM 제어판 > 사용자 및 그룹 > 해당 백업 계정 편집 > 응용 프로그램 탭에서 **WebDAV Server 허용** 체크.
- **네트워크 설정 상시 노출 및 테스트**: 자동 백업 활성화 여부와 관계없이 네트워크 백업 및 WebDAV 설정 폼은 상시 표시되며, 언제든 '테스트 실행' 버튼을 눌러 정상적으로 원격 저장소에 업로드되는지 검증할 수 있습니다.
- **연동 예외 보호 (Fail-safe)**: 네트워크 장애나 인증 오류 등으로 WebDAV/네트워크 복사가 실패하더라도 로컬 가계부 서비스 구동 및 로컬 자동 백업 전체 프로세스에는 영향을 미치지 않도록 장애 격리 설계가 적용되어 있습니다.

---

## 💾 데이터베이스 스키마 개요

SQLite 데이터베이스 파일에 생성되는 핵심 테이블 명세입니다:

| 테이블명 | 용도 | 주요 컬럼 |
| :--- | :--- | :--- |
| `categories` | Smart Spendlog 지출/수입 카테고리 마스터 | `id`, `name` (UNIQUE), `color`, `icon`, `type` |
| `pay_methods` | 결제수단(은행/카드사/페이 등) 마스터 | `id`, `name` (UNIQUE) |
| `rules` | 정규식 기반 알림 자동 분류 규칙 | `id`, `name` (UNIQUE), `pattern`, `category`, `pay_method`, `merchant_template`, `type` |
| `pass_rules` | 수신 시 Smart Spendlog 기록을 스킵할 패스 필터 규칙 | `id`, `name` (UNIQUE), `pattern`, `created_at` |
| `transactions` | 입출금 거래 내역 데이터 | `id`, `type`, `amount`, `merchant`, `category`, `pay_method`, `datetime`, `memo`, `raw_text`, `used_point` |
| `notification_logs` | 수신된 날것의 스마트폰 알림 히스토리 | `id`, `sender`, `raw_text`, `title`, `text`, `parsed_status`, `matched_rule_id`, `created_at` |
| `package_pay_methods`| 발신 앱 패키지명 기준 결제수단 강제 매핑 | `id`, `package` (UNIQUE), `pay_method` |
| `merchant_categories`| 가맹점별 카테고리 매핑 캐시 및 학습 데이터 | `id`, `merchant` (UNIQUE), `category` |
| `settings` | 사용자 개인별 설정값 (예산, 초기 잔액 등) | `key` (PRIMARY KEY), `value` |
| `login_security` | IP/사용자 계정별 로그인 실패 및 차단 기록 | `target` (PRIMARY KEY), `type`, `fail_count`, `last_failed_at`, `banned_until` |

---

## 💖 후원 (Support)

> [!NOTE]
> **Smart Spendlog**는 광고 없는 완전한 오픈소스이며, 개인의 스마트홈 환경에 밀착된 자동화 지향 스마트 가계부(Smart Spendlog) 솔루션입니다.  
> 지속적인 패치 제공과 고도화된 기능 추가를 위해 개발자에게 따뜻한 커피 한 잔을 후원해 주세요! ☕

<p align="center">
  <a href="https://ko-fi.com/plplaaa2" target="_blank">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" height="38" style="height: 38px; border: 0;" />
  </a>
  <br/>
  <sub>여러분의 소중한 후원이 안정적인 메인터넌스와 신기능 업데이트의 든든한 원동력이 됩니다. 🙏</sub>
</p>

