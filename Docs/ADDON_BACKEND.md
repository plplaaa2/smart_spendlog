# Add-on 백엔드 아키텍처

## 1. 역할

백엔드는 `account_book/`의 Node.js 서비스로서 HTTP API, 인증, 알림 수신, 거래 파싱, SQLite 저장, 분석, 백업과 Home Assistant 연동을 담당한다.

## 2. 구성

| 계층 | 위치 | 책임 |
|---|---|---|
| 실행 진입점 | `index.js`, `run.sh` | 서버 기동과 Add-on 실행 |
| 라우팅 | `routes/` | 인증, 거래, 알림, 규칙, 분석, 설정, Webhook API |
| 파싱 | `parser.js`, `parser/` | 원문 정규화, 날짜·결제수단·거래 분류 |
| 데이터 접근 | `database.js`, `database/` | SQLite 연결, 스키마와 CRUD |
| 보안 | `crypto_helper.js`, `database/security.js` | 민감정보 보호와 로그인 보안 |
| 백업 | `database/backup.js` | 데이터 백업·복원과 외부 저장 대상 처리 |
| HA 연동 | `database/ha_sync.js` | Home Assistant 센서 데이터 동기화 |
| 규칙·프리셋 | `default_rules.json`, `presets/` | 초기 분류 규칙과 업종별 기준 데이터 |

## 3. 요청 처리 흐름

```text
HTTP 요청
  -> 인증/보안 검사
  -> route handler
  -> parser 또는 service logic
  -> database layer
  -> JSON 응답
```

Webhook 알림은 원문을 먼저 보존한 후 파싱 결과와 매칭 규칙을 기록해야 한다. 파싱 실패도 원문과 실패 상태를 남겨 재처리할 수 있어야 한다.

## 4. 데이터 경계

- 원문 알림: `notification_logs`
- 거래: `transactions`
- 알림 재시도 거래 교체는 `database/retry_transaction.js`에서 삭제·삽입·로그 갱신을 단일 SQLite 트랜잭션으로 처리하며, 통합 테스트로 성공과 롤백 경로를 검증한다.
- `/api/notification_logs/:id/retry`는 Express HTTP 통합 테스트에서 실제 라우터와 SQLite를 연결하여 성공 및 404 응답 계약을 검증한다.
- 같은 통합 테스트에서 파싱 실패의 400 응답과 DB 교체 실패의 500 응답을 검증하며, 두 실패 경로 모두 기존 거래와 로그 상태를 보존해야 한다.
- 분류 기준: `rules`, `merchant_categories`, `package_pay_methods`
- 사용자 설정: `settings`
- 로그인 보안: `login_security`
- 백업: 애플리케이션 데이터 디렉터리와 외부 백업 대상

실제 테이블과 컬럼은 `database.js` 및 `database/` 구현을 기준으로 유지하며, 변경 시 마이그레이션 절차를 함께 기록한다.

`rules`는 `priority`(낮을수록 우선), `enabled`(파싱 적용 여부), `source`(`DEFAULT`, `USER`, `AUTO`, `AI`)를 가진다. 기존 DB에는 Add-on 시작 시 기본값을 추가하며 백업·복원에도 세 필드를 포함한다.
마이그레이션과 활성 규칙 정렬 계약은 SQLite 메모리 DB 통합 테스트로 검증한다.

## 5. 백엔드 규칙

- 라우트는 데이터베이스 구현 세부사항을 직접 중복하지 않는다.
- 외부 입력은 길이·형식·범위를 검증한다.
- SQL은 파라미터 바인딩을 사용한다.
- 외부 AI·백업 서비스 장애는 로컬 핵심 기능과 격리한다.
- 민감정보는 암호화 저장하고 로그·응답에서 마스킹한다.
- 오류는 사용자가 이해할 수 있는 응답과 개발자가 추적할 수 있는 내부 로그로 분리한다.

## 6. 추후 문서화 대상

- 라우트별 HTTP 메서드·경로·요청·응답 스키마
- SQLite 초기화 및 마이그레이션 전략
- Webhook 인증과 재전송 방지 정책
- 백업 암호화 키 관리와 복원 안전 절차
- Home Assistant 센서 생성·갱신 계약
