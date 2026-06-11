# SpendLog - Android 가계부 어플리케이션

본 프로젝트는 안드로이드의 알림(Notification) 권한 및 백그라운드 리스너 서비스를 활용하여 지출 및 수입 알림 문자/푸시 메시지를 자동으로 파싱하고, 이를 로컬 SQLite(Room DB)에 기록 및 관리하는 하이브리드 가계부 앱입니다. 

기존의 Home Assistant Addon 기반 오리지널 가계부(`account_book`) 시스템과 높은 데이터 호환성을 유지하도록 설계되었습니다.

---

## 🛠️ 주요 기능

1. **실시간 알림 파싱 및 저장 (`SpendLogListenerService`)**
   - 백그라운드에서 실행되는 노티피케이션 리스너가 금융 알림 메시지를 탐색합니다.
   - `NotificationParser` 모듈을 통해 금융사별 정형/비정형 정규식 패턴 매칭 및 AI 기반 자동 패턴 생성을 통해 거래 내역을 추출합니다.
   - 단시간 내 발생하는 중복 알림(1분 윈도우 기준)을 필터링합니다.

2. **로컬 데이터베이스 (`Room DB`)**
   - 결제 수단(`pay_methods`), 카테고리(`categories`), 가계부 기록(`records`), 자동 매핑 규칙(`rules`) 테이블을 로컬 SQLite에서 관리합니다.
   - 데이터 스키마의 `snake_case` 컬럼 매핑을 일관되게 규정하여 외부 쿼리 및 오리지널 가계부 백업과의 완벽한 연동을 보장합니다.

3. **웹뷰 기반 프론트엔드 대시보드 (`WebView Layout`)**
   - 자산 현황 요약 카드, 누적 저축액, 월간 지출/수입 추이 차트 및 분석 정보를 제공합니다.
   - 자산 카드에서 전체 자산 초기값과 개별 자산의 보정값을 자동으로 가산 및 렌더링합니다.
   - 네이티브 브릿지(`AndroidBridge`)와 `WebChromeClient` 설정을 통해 모바일 기기 내에서 셀렉트 박스, 파일 선택, 내보내기(공유 인텐트) 등의 네이티브 기능을 온전히 지원합니다.

---

## 📂 프로젝트 구조

프로젝트의 상세 파일 트리는 `tree.md` 파일을 참조하세요.

- **`app/src/main/java/`**: 코틀린 백엔드 브릿지, 룸 데이터베이스 엔티티, 알림 리스너 서비스, 메인 액티비티.
- **`app/src/main/assets/`**: 웹뷰에서 사용하는 HTML, CSS, JavaScript(대시보드 분석 및 테마 구현).
- **`caution.jsonl`**: 과거 개발 시 발생한 이슈 및 예방 가이드라인 목록.
- **`changelog.jsonl`**: 버전별 변경 이력 기록 파일.

---

## ⚠️ 개발 및 빌드 시 주의사항 (`caution.jsonl` 요약)

- **Room 2.6.x 및 KSP2 충돌 방지**: Gradle 빌드 중 `unexpected jvm signature V` 컴파일 오류를 예방하기 위해 `gradle.properties` 내 `ksp.useKSP2=false` 설정을 강제 적용하고 있습니다. KSP 버전 변경 시 Kotlin 버전과의 1:1 매칭 버전을 반드시 검증하세요.
- **API 라우팅 충돌 예방**: `MainActivity.kt`의 API 브릿지 라우팅(`when` 분기)은 문자열 매칭 시 하위 상세 경로(예: `merchant_categories`)를 상위 단축 경로(예: `categories`)보다 먼저 배치하거나 정확한 매치(`==`)를 사용해야 충돌이 없습니다.
- **DB 컬럼 스키마 호환**: Room 엔티티의 모든 카멜케이스 변수명은 반드시 `@ColumnInfo(name = "snake_case_name")`을 부착하여 백업/복원 파일 및 direct raw query와의 호환성을 확보해야 합니다.
- **백업 복원 수동 판별**: 오리지널 가계부의 `pay_methods` 테이블에는 `type` 필드가 누락되어 있어, 백업 복원 시 수동으로 텍스트 기반(예: '은행', '뱅크' 등의 키워드 검색) 분류 판별 로직을 거쳐 `BANK`와 `CARD`로 자동 정규화해야 합니다.
