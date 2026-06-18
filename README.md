# Smart Spendlog (HA Add-on)

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue?style=flat-square&logo=home-assistant)](https://github.com/plplaaa2/smart_spendlog)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-lightgrey?style=flat-square)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-F16061?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/plplaaa2)

Home Assistant Companion 앱의 알림(카드 승인 문자, 간편결제 푸시 등) 및 Webhook 호출을 수신하여 금액, 가맹점, 결제수단, 일시를 파싱하고 SQLite 데이터베이스에 기록한 뒤 웹 대시보드로 시각화하는 Smart Spendlog 서비스입니다.

---

## 🛠️ 주요 기능

- **실시간 알림 수신 및 자동 파싱**: WebSocket(HA Companion App) 및 Webhook 알림을 실시간으로 감시하여 정규식 기반으로 거래 내역(금액, 가맹점, 결제수단 등)을 정밀 파싱합니다.
- **다중 계정 격리 및 외부 접속 보안**: 사용자별 독립 SQLite DB 파일을 격리 운영하며, 토큰 기반 인증 및 로그인 지수 대기 잠금(Exponential Backoff), IP API 속도 제한을 통해 보안을 극대화합니다.
- **자동 분류 학습 및 가맹점 프리셋**: 230개 이상의 가맹점 프리셋 사전에 기반해 카테고리를 자동 학습 및 재분류하며, 결제수단과 결제방식(신용/체크)을 완전히 독립 필드로 관리합니다.
- **반응형 웹 대시보드 & 통계**: 모바일 및 태블릿에 최적화된 반응형 2행 헤더 레이아웃을 제공하며, 일반/고정지출 통계 분석 및 HTML 시각화 그래프를 결합한 AI 소비 분석 리포트(v2.2.1)를 지원합니다.
- **데이터 백업 및 이중화**: 로컬 JSON 자동 백업 및 복원 기능과 더불어 Samba(공유 폴더) 및 WebDAV 원격 서버로의 AES-256 암호화 이중화 백업을 제공합니다.
- **Home Assistant 센서 연동**: 사용자의 월간 수입, 지출, 남은 예산, 순이익, 저축액 등 5종 핵심 메트릭 지표 센서를 HA 상에 실시간으로 자동 생성 및 동기화합니다.

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

