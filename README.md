# Home Assistant 가계부 Add-on (HA Account Book)

Home Assistant Companion 앱이 스마트폰에서 수신한 알림(카드 승인 문자, 간편결제 승인 푸시 등)을 실시간으로 가져와 지출 금액, 사용처, 카테고리를 자동으로 분석 및 기록하고, 시각적 대시보드로 보여주는 가계부 Add-on 서비스입니다.

---

## 🌟 주요 특징

1. **실시간 알림 수신 (WebSocket & Webhook)**
   - Home Assistant Companion 앱의 `마지막 알림(Last Notification)` 센서를 실시간 모니터링하여 알림이 뜨는 즉시 파싱합니다.
   - 외부 웹훅 엔드포인트(`POST /api/webhook`)도 제공하여 HA 자동화나 Tasker 앱 등 다양한 방식으로 데이터를 입력받을 수 있습니다.

2. **동적 정규식 파싱 엔진 (Regex Engine)**
   - 사용자마다 다른 카드사 문자 형식을 직접 웹 UI에서 정규식으로 등록할 수 있습니다.
   - Named Capture Group (`(?<amount>...)`, `(?<merchant>...)`, `(?<time>...)`)을 사용하여 금액과 사용처, 승인 일시를 유연하게 추출합니다.

3. **고품격 Glassmorphism 대시보드**
   - 이번 달 총 지출, 일자별 소비 흐름 라인 차트, 카테고리별 비중 도넛 차트를 Chart.js를 통해 직관적으로 보여줍니다.
   - 상세 소비 내역 조회, 필터링 및 수동 추가/수정/삭제를 편리하게 처리할 수 있습니다.

4. **파싱 로그 및 규칙 원클릭 생성**
   - 수신된 모든 생 알림 문자를 로그로 기록합니다.
   - 파싱에 실패한 알림은 로그 목록에서 바로 **"규칙 만들기"**를 클릭하여 정규식을 테스트하고 새로운 파싱 규칙으로 즉시 추가할 수 있습니다.

---

## 📂 파일 구조

```
d:\HA\ADDON\account_book
├── config.json          # Home Assistant Add-on 메타데이터 및 Ingress 설정
├── Dockerfile           # Alpine Node.js 기반 컨테이너 빌드 파일
├── run.sh               # Add-on 실행 셸 스크립트
├── package.json         # Express, sqlite3, ws 의존성 정의
├── database.js          # SQLite3 데이터베이스 초기화 및 기본 씨드(Seed) 데이터 입력
├── parser.js            # 정규식 기반 알림 파싱 엔진 모듈
├── index.js             # 백엔드 서버 엔트리포인트 (API 라우팅 및 웹소켓 연동)
└── public/              # 프론트엔드 정적 웹 리소스
    ├── index.html       # 웹 UI 구조
    ├── style.css        # Glassmorphic 스타일시트
    └── app.js           # 탭 제어, API 호출, Chart.js 렌더링 스크립트
```

---

## ⚙️ Home Assistant 설치 방법

1. 본 프로젝트 폴더(`account_book`)를 Home Assistant의 `addons` 디렉토리에 복사합니다.
2. Home Assistant 홈 화면 &gt; 설정 &gt; 기기 및 서비스 &gt; **Add-on** 메뉴로 이동합니다.
3. 오른쪽 아래 **'애드온 스토어'**로 들어간 뒤, 우측 상단 메뉴에서 **'애드온 재로드'**를 클릭합니다.
4. 로컬 애드온 목록에 나타난 **'HA Account Book'**을 선택한 뒤 **'설치'**를 클릭합니다.
5. 설치가 완료되면 **'사이드바에 표시'**를 활성화하고 **'시작'**을 클릭합니다.
6. 사이드바에 추가된 **'가계부'** 탭을 클릭하여 대시보드 웹 UI에 접속합니다.

---

## 📱 알림 센서 연동 설정

### 방법 1: WebSocket 자동 수신 (권장)
1. 사용자의 Android 스마트폰에 **Home Assistant 공식 앱**을 설치합니다.
2. 앱 설정 &gt; 구성원 설정 &gt; 센서 관리에서 **'마지막 알림(Last Notification)'** 센서를 찾아 활성화합니다.
3. 가계부 웹 UI의 **'설정'** 탭으로 이동하여 해당 센서의 Entity ID(예: `sensor.galaxy_s24_last_notification`)를 입력하고 저장합니다.
4. 이제 스마트폰에 결제 알림이 올 때마다 가계부가 백그라운드 웹소켓으로 자동 분석하여 등록합니다.

### 방법 2: HA 자동화를 활용한 웹훅(Webhook) 전송
수동으로 특정 조건의 알림만 가계부로 푸시하려면 아래와 같이 Home Assistant 자동화(Automation)를 구성할 수 있습니다.

```yaml
alias: "가계부: 카드 알림 전송 자동화"
trigger:
  - platform: state
    entity_id: sensor.my_phone_last_notification
condition:
  # 알림 내용이 유효할 때만 실행
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

## 💻 로컬 개발 및 테스트 방법 (Windows)

개발 환경에서 백엔드 및 프론트엔드가 정상 작동하는지 직접 로컬에서 기동해볼 수 있습니다.

1. **의존성 모듈 설치**:
   ```powershell
   npm install
   ```
2. **로컬 서버 기동**:
   ```powershell
   node index.js
   ```
   서버가 기동되면 `http://localhost:8124`에 브라우저로 접속하여 UI를 확인하고 가계부 데이터를 테스트할 수 있습니다.
   *(로컬 기동 시 SQLite 데이터베이스 파일은 프로젝트 폴더 내 `./data/account_book.db` 경로에 생성됩니다.)*
