# Smart Spendlog 시스템 아키텍처

## 1. 목적

Smart Spendlog는 Home Assistant 환경에서 금융 알림과 사용자가 입력한 거래를 수집하고, 거래 정보를 분류·저장·조회하는 개인 가계부 Add-on이다.

## 2. 저장소와 제품 경계

현재 저장소의 기준 제품은 Home Assistant Add-on이다.

| 영역 | 위치 | 상태 |
|---|---|---|
| Add-on | `account_book/` | 현재 개발 대상 |
| 공통 문서 | `Docs/` | Add-on과 향후 Android가 공유 |
| Android | 별도 프로젝트 예정 | 완전히 새로 설계 |

Android는 기존 `android_spendlog/` 산출물을 현재 Add-on 저장소의 업로드 대상에 포함하지 않는다.

## 3. 논리 구성

```text
Home Assistant / Companion App / Webhook
                |
                v
       Add-on HTTP Server (Node.js)
          |              |
          |              +--> Authentication / Session
          |              +--> Notification & Transaction Routes
          |              +--> Analytics / Settings / Rules Routes
          v
       Parser & Classification
          |              |
          v              v
       SQLite Database   AI Provider (optional)
          |
          +--> Backup / Restore
          +--> Home Assistant Sensor Sync
          v
       Web Frontend
```

## 4. 핵심 데이터 흐름

1. 알림 또는 Webhook 요청이 Add-on API로 들어온다.
2. 백엔드는 원문 알림을 기록하고 파서·결제수단 resolver·분류 규칙을 적용한다.
3. 정규화된 거래를 SQLite에 저장한다.
4. 웹 프론트엔드는 인증된 API를 통해 거래·규칙·분석·설정을 조회하고 변경한다.
5. 필요할 때 Home Assistant 센서 동기화와 백업 기능이 데이터 계층을 사용한다.

## 5. 알림 파싱 실행 순서

아래 순서는 현재 `account_book/routes/webhook.js`의 `processNotificationCore()`와
`account_book/parser/` 구현을 기준으로 정리한 실제 처리 순서이다.

```text
Home Assistant 상태 변경 / HTTP Webhook
                    |
                    v
          알림 입력 필드 추출 및 큐 등록
          title + text + package + username
                    |
                    v
             사용자별 순차 큐 처리
                    |
                    v
            title/text 원문 조합
                    |
                    v
       광고·인증번호·OTP 등 선행 제외 검사
          | 제외                         | 통과
          v                              v
       처리 종료                   패스 규칙 검사
                                   | 일치       | 불일치
                                   v            v
                              PASS 로그 저장   일반 규칙 조회
                                                    |
                                                    v
                                          정규식 기반 파싱
                                          | 성공       | 실패
                                          v            v
                                      파싱 결과      AI 파싱 사용 여부
                                                       | 사용       | 미사용/실패
                                                       v            v
                                                  AI 파싱       자동 규칙 생성 여부
                                                  | 성공           | 사용       | 미사용/실패
                                                  v                v            v
                                          AI 규칙 캐시 시도   로컬 패턴 생성   FAILED 로그
                                                  |                |
                                                  +-------+--------+
                                                          v
                                                    파싱 결과 후처리
                                                          |
                                                          v
                                          결제수단·결제방식·카테고리 보정
                                                          |
                                                          v
                                           자산 이동·카드대금 특수 처리
                                                          |
                                                          v
                                                  중복 거래 검사
                                              | 중복             | 신규
                                              v                  v
                                      IGNORED_DUPLICATE      거래 저장
                                           로그 저장              |
                                                                 v
                                                   SUCCESS 알림 로그 저장
                                                                 |
                                                                 v
                                                  HA 센서·인앱 알림 갱신
```

### 5.1 입력과 원문 구성

1. WebSocket 입력은 `newState.attributes`에서 제목, 본문, 패키지명을 읽는다.
2. HTTP Webhook 입력은 JSON 본문의 `title`, `text`, 패키지명, 사용자명을 읽는다.
3. 모든 입력은 전역 알림 큐에 들어가 한 건씩 순차 처리된다.
4. 제목과 본문이 모두 있으면 하나의 `rawText`로 조합한다.
5. 광고, 인증번호, OTP, 쿠폰 등의 제외 표현이 있으면 로그를 만들지 않고 종료한다.

### 5.2 규칙 선택과 파싱 우선순위

1. 관리자 DB의 `pass_rules`를 먼저 검사한다.
2. 패스 규칙에 일치하면 거래를 만들지 않고 `PASS` 로그만 저장한다.
3. 패스 규칙에 일치하지 않으면 관리자 DB의 `rules`를 조회한다.
4. `parseNotification()`은 전달받은 규칙을 앞에서부터 검사하고, 처음으로 유효하게 파싱된 결과를 반환한다.
5. 정규식 파싱이 실패하고 AI 파싱 설정이 활성화되어 있으면 `parseNotificationWithAI()`를 호출한다.
6. AI 파싱에 성공하면 같은 형식의 후속 알림에 사용할 AI 생성 규칙의 저장을 시도한다.
7. 여전히 결과가 없고 자동 규칙 생성이 활성화되어 있으면 로컬 패턴 생성기로 규칙을 만든 후 다시 파싱한다.
8. 모든 단계가 실패하면 거래를 생성하지 않고 `FAILED` 알림 로그를 저장한다.

### 5.3 정규식 파서 내부 순서

`account_book/parser/text_parser.js`의 한 규칙에 대한 처리 순서는 다음과 같다.

1. 방향 제어용 유니코드 문자와 Windows 줄바꿈을 정규화한다.
2. 저장된 패턴의 명명 캡처 그룹을 camelCase 형태로 보정한 뒤 정규식을 컴파일한다.
3. `amount` 캡처를 숫자로 변환하고 USD 여부를 판별한다.
4. 금액 캡처가 날짜·시간 영역을 잘못 가리키는지 검사한다.
5. `merchant` 또는 `usage` 캡처를 정리하고 브랜드명을 보정한다.
6. `time`, `datetime`, `date` 순서로 거래일시를 해석한다.
7. 일시가 없으면 Webhook 처리 시각을 사용한다.
8. 규칙·캡처·원문을 이용해 결제수단과 결제방식을 결정한다.
9. 포인트, 계좌, 잔액, 누적금액을 부가정보로 추출한다.
10. 입금·출금·승인·취소 표현과 규칙 기본값으로 거래 유형을 결정한다.
11. 정규화된 파싱 결과를 Webhook 처리 계층에 반환한다.

### 5.4 파싱 이후 저장 전 보정

1. 알림 패키지별 결제수단 매핑이 있으면 규칙의 결제수단보다 우선 적용한다.
2. 체크카드 알림은 연결 은행 또는 계좌이체 결제수단으로 보정한다.
3. 가맹점 학습 데이터와 거래 유형을 이용해 카테고리를 결정한다.
4. 본인 계좌 간 이동과 카드대금 출금을 별도 카테고리로 보정한다.
5. 동일 유형·금액·인접 시각의 기존 거래를 조회해 중복 여부를 판단한다.
6. USD 거래는 저장 직전에 설정값 또는 외부 환율을 적용해 원화 금액을 계산한다.
7. 신규 거래를 `transactions`에 저장하고 처리 결과를 `notification_logs`에 기록한다.
8. 거래 저장 후 Home Assistant 센서와 사용자 알림을 갱신한다.

### 5.5 파싱 관련 파일 책임

| 파일 | 책임 |
|---|---|
| `account_book/routes/webhook.js` | 입력 수집, 큐, 파싱 단계 선택, 후처리, 중복 검사, 저장 |
| `account_book/parser.js` | 파서 공개 진입점 |
| `account_book/parser/text_parser.js` | 정규식 규칙 매칭과 결과 조립 |
| `account_book/parser/datetime_parser.js` | 거래일시 해석 |
| `account_book/parser/payment_resolver.js` | 결제방식 판별 |
| `account_book/parser/transaction_classifier.js` | 수입·지출·취소 유형 판별 |
| `account_book/parser/pattern_generator.js` | 실패 원문 기반 로컬 정규식 생성 |
| `account_book/parser/ai_parser.js` | AI 파싱과 AI 정규식 생성 |
| `account_book/parser/utils.js` | 정규식과 가맹점 문자열 보정 |
| `account_book/default_rules.json` | 기본 파싱·패스 규칙 데이터 |

## 6. 설계 원칙

- 거래 원문과 파싱 결과를 분리해 추적 가능성을 유지한다.
- 인증·보안 실패 기록은 일반 거래 데이터와 분리한다.
- AI 분석은 선택 기능이며 기본 거래 저장 흐름을 차단하지 않는다.
- 백업 실패가 로컬 거래 저장과 Add-on 구동을 중단시키지 않도록 한다.
- 비밀번호, API 키, 토큰은 문서와 로그에 평문으로 남기지 않는다.

## 7. 현재 확인된 주요 모듈

- 진입점: `account_book/index.js`
- 라우트: `account_book/routes/`
- 파싱: `account_book/parser.js`, `account_book/parser/`
- 데이터베이스: `account_book/database.js`, `account_book/database/`
- 웹 정적 파일: `account_book/public/`
- 기본 규칙·프리셋: `account_book/default_rules.json`, `account_book/presets/`

세부 API 계약, 인증 세션 정책, Home Assistant 센서 목록은 코드 검증 후 별도 문서로 확정한다.
