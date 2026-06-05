# 📊 Smart Spendlog 알림 파싱 파이프라인 흐름도

이 문서는 웹훅(Webhook) 또는 WebSocket을 통해 알림이 수신되었을 때, 전체 파싱 엔진이 어떻게 유형을 판별하고 처리 루트를 타는지 시각화한 흐름도입니다.

```mermaid
flowchart TD
    %% 시작 및 전처리
    Start(["1. 웹훅 / 알림 이벤트 수신"]) --> Preprocess["2. 텍스트 결합 및 개행 표준화 <br> rawText 생성"]
    Preprocess --> PassCheck{"3. 0순위: 패스 규칙 대조 <br> pass_rules 매칭?"}
    
    %% 패스 규칙 종료
    PassCheck -- "예 (PASS)" --> LogPass["알림 로그에 'PASS' 기록"] --> EndPass(["종료"])
    
    %% 정규식 대조
    PassCheck -- "아니오" --> RegexMatch{"4. 정규식 규칙 대조 <br> parseNotification 매칭?"}
    
    %% ==========================================
    %% [루트 A] 정규식 파싱 성공 루트
    %% ==========================================
    RegexMatch -- "성공 (루트 A)" --> ParseBasic["금액 검증, 사용처, 일시, <br> 결제수단 1차 추출"]
    
    ParseBasic --> DetermineTypeA{"수입/지출 타입 판별 <br> (우선순위)"}
    DetermineTypeA --> |"1순위"| TypeGroup["정규식 Named Group의 <br> status/type_text 분석"]
    DetermineTypeA --> |"2순위"| TypeRule["정규식 규칙에 지정된 <br> rule.type 설정"]
    DetermineTypeA --> |"3순위"| TypePreemptive["본문 전체 키워드 검사 <br> 입금 vs 출금/신용/체크"]
    DetermineTypeA --> |"4순위"| TypeDefault["기본값: 지출 EXPENSE"]
    
    TypeGroup & TypeRule & TypePreemptive & TypeDefault --> PostProcess["카테고리 동적 매핑 & <br> 통장/자산 이동 감지 & <br> 체크카드 결제수단 보정"]
    
    PostProcess --> DupCheck{"최근 30초 이내 <br> 중복 거래 감지?"}
    DupCheck -- "예" --> LogDup["알림 로그에 'IGNORED_DUPLICATE' 기록"] --> EndDup(["중복 차단 종료"])
    DupCheck -- "아니오" --> DBInsert["Transactions 테이블 등록 및 <br> HA 센서 갱신, 로그 기록"] --> EndSuccess(["정상 등록 종료"])

    %% ==========================================
    %% [루트 B] 정규식 파싱 실패 루트
    %% ==========================================
    RegexMatch -- "실패 (루트 B)" --> PreemptiveDetermine["본문 전체 키워드 선제 판별 <br> preemptiveType 결정 <br> 입금 vs 출금/신용/체크"]
    
    PreemptiveDetermine --> AICheck{"AI 자동 파싱 <br> 설정 활성화?"}
    
    %% AI 파싱 루트
    AICheck -- "예" --> AIParse{"AI 파싱 API 호출 <br> parseNotificationWithAI"}
    AIParse -- "성공" --> AICache["AI 생성 정규식 <br> rules 테이블에 캐싱 등록"] --> PostProcess
    AIParse -- "실패" --> AutoRuleCheck
    
    %% 로컬 자동 생성 루트
    AICheck -- "아니오" --> AutoRuleCheck{"자동 규칙 생성 <br> 설정 활성화?"}
    AutoRuleCheck -- "예" --> LocalGen["로컬 텍스트 분석 알고리즘 <br> generatePatternFromText <br> 정규식 자동 생성 및 DB 저장"] --> PostProcess
    
    %% 최종 실패
    AutoRuleCheck -- "아니오" --> LogFail["알림 로그에 'FAILED' 기록"] --> EndFail(["등록 실패 종료"])
```

---

## 💡 주요 단계 설명

### 1. 패스 규칙 (0순위)
* 분석에 돌입하기 전, 사용자가 지정해 둔 광고나 단순 정보 알림성 키워드 목록(`pass_rules`)에 매칭되는지 대조하여 무의미한 AI API 호출 및 정규식 검사 자원을 즉각 아낍니다.

### 2. [루트 A] 정규식 파싱 성공 루트
* 매칭에 성공한 경우, 사용자가 작성하여 검증해 둔 정규식 규칙 정보를 최우선 적용합니다.
* **수입/지출 판별 우선순위**:
  1. 정규식 캡처 그룹 안의 상태 정보 (`status`, `type_text`에 수입/지출/취소 검출 시)
  2. 룰에 직접 명시된 수입/지출 설정 (`rule.type`)
  3. 본문 전체 키워드 선제 판독 (`preemptiveType`)
  4. 기본값인 지출 (`EXPENSE`)
* 이로 인해 사용자가 특별히 수입 룰로 등록해 둔 거래가 본문 내 카드 지시어(예: "신용")에 의해 지출로 오파싱되는 현상을 완벽히 격리합니다.

### 3. [루트 B] 정규식 파싱 실패 루트 (AI 및 자동 생성)
* 매칭에 실패해 파싱 기준이 없는 상태이므로, AI 및 자동 규칙 생성 단계로 넘어가기 직전에 **본문 전체 키워드 검사**를 즉시 수행하여 타입을 **선제 결정**합니다.
* AI 파싱 요청 프롬프트와 로컬 자동 생성 알고리즘에 이 판정된 타입 값을 넘겨주어 AI 캐싱 등록 규칙 및 로컬 임시 규칙의 데이터 정합성을 확보합니다.
