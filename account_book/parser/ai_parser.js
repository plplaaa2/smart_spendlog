const { parsePaymentType } = require('./payment_resolver');

async function parseNotificationWithAI(text, config, fallbackDatetime = null) {
  if (!text || !config) return null;

  const cleanText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n/g, '\n');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const defaultFallback = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const resolvedFallback = fallbackDatetime || defaultFallback;

  const prompt = `You are a financial transaction SMS/notification parser.
Analyze the following notification text and extract transaction details.
You MUST output the result ONLY as a JSON object, without markdown formatting or code blocks.
The JSON object MUST contain the following fields:
- "amount" (integer): The transaction amount. If it is a foreign currency transaction (like USD, JPY, EUR), calculate the approximate equivalent amount in Korean Won (KRW) (e.g. multiply USD by 1350, JPY by 9, EUR by 1450).
- "merchant" (string): The merchant, sender, or receiver name. Keep it clean (e.g. extract "이마트" from "이마트 신도림점").
- "datetime" (string): Format: "YYYY-MM-DD HH:mm:ss". Use the transaction time from the text. If the year is not mentioned, use the current year from fallback date: ${resolvedFallback}. If no date/time is mentioned, use fallback date: ${resolvedFallback}.
- "pay_method" (string): The payment method name (e.g., "KB국민체크", "신한카드", "토스", "농협" etc.).
- "pay_type" (string): The payment type. Must be one of "CREDIT" (credit card/default), "CHECK" (check card/debit), "TRANSFER" (bank transfer/wire), or "CASH" (cash).
- "type" (string): "EXPENSE" for spending/outflow, "INCOME" for deposit/inflow.
- "original_amount" (number, optional): The original foreign transaction amount if it is not in KRW (e.g. 12.34). Otherwise, null.
- "currency" (string, optional): The original currency code (e.g. "USD", "JPY", "EUR") if it is a foreign transaction. Otherwise, null.

Notification Text: "${cleanText}"
Fallback Date: "${resolvedFallback}"

Example Output:
{
  "amount": 12500,
  "merchant": "스타벅스",
  "datetime": "2026-06-02 14:30:00",
  "pay_method": "신한카드",
  "pay_type": "CHECK",
  "type": "EXPENSE",
  "original_amount": null,
  "currency": null
}
`;

  try {
    let responseText = '';
    const provider = config.provider || 'gemini';

    if (provider === 'gemini') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('Gemini API Key가 누락되었습니다.');

      const models = ['gemini-3.1-flash-lite'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json'
              }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
            responseText = data.candidates[0].content.parts[0].text;
            success = true;
            console.log(`[AI 파서] Gemini 모델 ${model} 파싱 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 파서] Gemini 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('Gemini API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'openai') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('OpenAI API Key가 누락되었습니다.');

      const models = ['gpt-5.4-nano'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = 'https://api.openai.com/v1/chat/completions';
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.choices && data.choices[0] && data.choices[0].message) {
            responseText = data.choices[0].message.content;
            success = true;
            console.log(`[AI 파서] OpenAI 모델 ${model} 파싱 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 파서] OpenAI 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('OpenAI API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'local') {
      const localIp = config.localIp;
      const localModel = config.localModel || 'local-model';
      if (!localIp) throw new Error('로컬 OpenAI 호환 IP가 누락되었습니다.');

      const url = `${localIp}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: localModel,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        responseText = data.choices[0].message.content;
        console.log(`[AI 파서] 로컬 OpenAI 호환 모델 ${localModel} 파싱 성공`);
      } else {
        throw new Error('올바르지 않은 로컬 API 응답 형식입니다.');
      }
    }

    if (!responseText) {
      return null;
    }

    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const result = JSON.parse(jsonText);

    if (!result.amount || isNaN(parseInt(result.amount, 10))) {
      console.warn('[AI 파서] 파싱된 금액 정보가 올바르지 않습니다:', result.amount);
      return null;
    }

    let aiPayType = result.pay_type || '';
    let paymentType = '';
    if (aiPayType) {
      const cleanPt = aiPayType.trim();
      if (/체크/.test(cleanPt) || /CHECK/i.test(cleanPt)) paymentType = 'CHECK';
      else if (/이체|송금/.test(cleanPt) || /TRANSFER/i.test(cleanPt)) paymentType = 'TRANSFER';
      else if (/현금/.test(cleanPt) || /CASH/i.test(cleanPt)) paymentType = 'CASH';
      else if (/신용|일시불|할부/.test(cleanPt) || /CREDIT/i.test(cleanPt)) paymentType = 'CREDIT';
    }
    if (!paymentType || paymentType === 'UNKNOWN') {
      paymentType = parsePaymentType(cleanText, result.pay_method);
      if (paymentType === 'BANK_TRANSFER') {
        paymentType = 'TRANSFER';
      }
    }
    if (!paymentType || paymentType === 'UNKNOWN') {
      paymentType = 'CREDIT';
    }

    return {
      amount: parseInt(result.amount, 10),
      merchant: (result.merchant || '알수없음').trim(),
      datetime: result.datetime || resolvedFallback,
      pay_method: (result.pay_method || '카드').trim(),
      payment_type: paymentType,
      type: result.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      original_amount: result.original_amount ? parseFloat(result.original_amount) : null,
      currency: result.currency ? String(result.currency).toUpperCase() : null
    };

  } catch (err) {
    console.error('[AI 파서 오류]:', err.message);
    return null;
  }
}

async function generatePatternWithAI(text, config) {
  if (!text || !config) return null;

  const cleanText = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n/g, '\n');

  const prompt = `You are a regex pattern builder.
Build a JavaScript Regular Expression (RegExp) pattern that parses the following financial SMS/push notification text.
The regex pattern MUST extract the following values using NAMED CAPTURE GROUPS:
- "amount" (e.g. (?<amount>[\\d,]+) or similar): Extracts the transaction amount (REQUIRED).
- "merchant" (e.g. (?<merchant>.+?)): Extracts the merchant or sender.
- "time" (e.g. (?<time>\\d{2}/\\d{2}\\s+\\d{2}:\\d{2}) or similar): Extracts the date/time (optional but recommended if present).
- "account" (e.g. (?<account>[\\d*-]+)): Extracts the account number (optional).
- "balance" (e.g. (?<balance>[\\d,]+)): Extracts the remaining balance (optional).
- "cumulative" (e.g. (?<cumulative>[\\d,]+)): Extracts the cumulative monthly spending (optional).
- "usedPoint" (e.g. (?<usedPoint>[\\d,]+)): Extracts points/credits used (optional).
- "payMethod" (e.g. (?<payMethod>[^\\s/]+)): Extracts payment method/source such as bank or card brand name (optional).
- "payType" (e.g. (?<payType>[^\\s/]+)): Extracts payment type such as credit, checking, transfer, or cash (optional).

CRITICAL RULE FOR NAMED CAPTURE GROUPS:
Named capture group names MUST NOT contain underscores ('_'). They must use strictly camelCase or simple letters (e.g. use 'merchantName' instead of 'merchant_name', 'payMethod' instead of 'pay_method'). Underscores in group names cause regex syntax errors in Android mobile environment.

CRITICAL RULE FOR NEWLINES/SPACES:
DO NOT use raw newlines (\\n or \\r\\n) in the pattern. Instead, use \\\\s+ or \\\\s* to match line breaks and whitespaces to make the pattern platform-independent.

CRITICAL RULE FOR CURRENCY SYMBOLS:
If currency symbols like ₩, $, or \\ are present in the amount, ensure the pattern matches them outside or inside the group appropriately (e.g. \\\\(?<amount>[\\\\d,]+) or ₩(?<amount>[\\\\d,]+)).

The pattern MUST match the entire text or its major part. Escape bracket characters properly (e.g. \\[KB국민\\]).
Notice that double backslashes should be used since it will be parsed as JSON.

Notification Text: "${cleanText}"

You MUST output the result ONLY as a JSON object, without markdown formatting or code blocks.
The JSON object MUST contain the following fields:
- "pattern" (string): The constructed RegExp pattern.
- "pay_method" (string): The extracted payment method name (e.g. "신한카드", "국민은행"). Use "카드" as default.
- "pay_type" (string): The payment type. Must be one of "CREDIT", "CHECK", "TRANSFER", "CASH". Use "CREDIT" as default.
- "type" (string): "EXPENSE" or "INCOME".

Example Output:
{
  "pattern": "^(?:\\\\[Web발신\\\\])?\\\\s*결제\\\\s+(?<amount>[\\\\d,]+)원\\\\s+(?<merchant>.+?)$",
  "pay_method": "카드",
  "pay_type": "CREDIT",
  "type": "EXPENSE"
}`;

  try {
    let responseText = '';
    const provider = config.provider || 'gemini';

    if (provider === 'gemini') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('Gemini API Key가 누락되었습니다.');

      const models = ['gemini-3.1-flash-lite'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json'
              }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
            responseText = data.candidates[0].content.parts[0].text;
            success = true;
            console.log(`[AI 패턴빌더] Gemini 모델 ${model} 생성 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 패턴빌더] Gemini 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('Gemini API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'openai') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('OpenAI API Key가 누락되었습니다.');

      const models = ['gpt-5.4-nano'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = 'https://api.openai.com/v1/chat/completions';
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.choices && data.choices[0] && data.choices[0].message) {
            responseText = data.choices[0].message.content;
            success = true;
            console.log(`[AI 패턴빌더] OpenAI 모델 ${model} 생성 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 패턴빌더] OpenAI 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('OpenAI API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'local') {
      const localIp = config.localIp;
      const localModel = config.localModel || 'local-model';
      if (!localIp) throw new Error('로컬 OpenAI 호환 IP가 누락되었습니다.');

      const url = `${localIp}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: localModel,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        responseText = data.choices[0].message.content;
        console.log(`[AI 패턴빌더] 로컬 OpenAI 호환 모델 ${localModel} 생성 성공`);
      } else {
        throw new Error('올바르지 않은 로컬 API 응답 형식입니다.');
      }
    }

    if (!responseText) {
      return null;
    }

    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const result = JSON.parse(jsonText);
    
    let aiPayType = result.pay_type || '';
    let paymentType = '';
    if (aiPayType) {
      const cleanPt = aiPayType.trim();
      if (/체크/.test(cleanPt) || /CHECK/i.test(cleanPt)) paymentType = 'CHECK';
      else if (/이체|송금/.test(cleanPt) || /TRANSFER/i.test(cleanPt)) paymentType = 'TRANSFER';
      else if (/현금/.test(cleanPt) || /CASH/i.test(cleanPt)) paymentType = 'CASH';
      else if (/신용|일시불|할부/.test(cleanPt) || /CREDIT/i.test(cleanPt)) paymentType = 'CREDIT';
    }
    if (!paymentType || paymentType === 'UNKNOWN') {
      paymentType = parsePaymentType(text, result.pay_method);
      if (paymentType === 'BANK_TRANSFER') {
        paymentType = 'TRANSFER';
      }
    }
    if (!paymentType || paymentType === 'UNKNOWN') {
      paymentType = 'CREDIT';
    }

    let pattern = result.pattern || null;
    if (pattern) {
      // ICU 정규식 에러(U_REGEX_INVALID_CAPTURE_GROUP_NAME) 방지:
      // 명명된 캡처 그룹(?<group_name>)에서 언더바(_)를 모두 카멜케이스로 치환
      pattern = pattern.replace(/\(\?<([a-zA-Z0-9_]+)>/g, (match, groupName) => {
        if (groupName.includes('_')) {
          const camelGroupName = groupName.replace(/_([a-z0-9])/gi, (m, letter) => letter.toUpperCase()).replace(/_/g, '');
          return `(?<${camelGroupName}>`;
        }
        return match;
      });
    }

    return {
      pattern: pattern,
      pay_method: (result.pay_method || '카드').trim(),
      pay_type: paymentType,
      type: result.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
    };

  } catch (err) {
    console.error('[AI 패턴빌더 오류]:', err.message);
    return null;
  }
}

async function generateConsumptionReportWithAI(dataText, config) {
  if (!dataText || !config) return null;

  const prompt = `당신은 대한민국 최고의 금융 분석가이자 개인 자산 관리 코치입니다.
사용자의 가계부 통계 데이터를 심층적으로 분석하여, 현재 소비 성향을 진단하고 실용적이고 구체적인 재정 피드백 리포트를 마크다운(Markdown) 및 HTML 요소의 조합으로 보기 쉽게 작성해 주세요.

[분석 대상 통계 데이터]
${dataText}

[작성 및 출력 규칙]
1. 반드시 한국어로 정중하게 작성해 주십시오. (존댓말 사용)
2. 출력은 반드시 다음과 같은 JSON 객체 하나만 반환해야 하며, 마크다운 코드 블록이나 기타 텍스트 설명은 절대로 덧붙이지 마십시오. (JSON 순수 텍스트만 출력)
{
  "summary": "가계의 현재 소비 요약 한 줄 평 (예: '이번 달은 온라인 쇼핑 지출이 평소보다 25% 늘어났지만, 고정 지출을 성공적으로 통제한 한 달입니다.')",
  "content": "여기에 상세한 리포트 본문 텍스트를 기재하십시오. 줄바꿈은 \\n 으로 이스케이프해야 합니다."
}

3. content (리포트 본문) 구성 규칙:
   - 가독성과 심미성을 극대화하기 위해, 텍스트(마크다운) 설명과 함께 인라인 스타일(style="...")이 지정된 HTML/CSS 기반의 동적 그래프(차트) 및 분석 카드를 적극 활용하여 렌더링하도록 마크업을 설계하십시오.
   - 중요: 리포트 내에 포함되는 모든 HTML/CSS 요소(하위 예시 1, 예시 2 전체 구조 포함)는 코드 내부에 줄바꿈(\n)을 절대로 포함하지 말고, 반드시 단 한 줄의 길고 완성된 단일 행(Single Line) 텍스트로 합쳐서 출력하십시오. 줄 단위 마크다운 분석 파서가 각 행을 쪼개는 과정에서 HTML 구조 내부에 원치 않는 문단 태그(<p>)를 주입하거나 닫는 태그를 오인하여 레이아웃이 깨지고 깨진 빈 여백만 잔뜩 노출되는 현상을 근본적으로 차단하기 위함입니다.
   - 모던하고 세련된 가계부 UI에 자연스럽게 어우러지고 다크/라이트 테마에 동적으로 반응하도록 테마 변수(예: 'var(--text-primary)', 'var(--text-secondary)', 'var(--glass-bg)', 'var(--glass-border)')를 적극 사용하여 마크업을 설계하십시오. 글씨 색상에 하드코딩된 흰색(rgba(255,255,255,x) 또는 #fff 등)을 절대 사용하지 마십시오.
   - [시각화 요소 예시 1 - 카테고리별 비중 가로 막대 그래프]:
     <div style="background: var(--glass-bg); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid var(--glass-border);">
       <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px; color: var(--text-primary);">
         <span>🍔 식비 (지출 비중 45.3%)</span>
         <strong style="color: #6366f1;">453,000원</strong>
       </div>
       <div style="width: 100%; height: 8px; background: var(--glass-border); border-radius: 4px; overflow: hidden;">
         <div style="width: 45.3%; height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7); border-radius: 4px;"></div>
       </div>
     </div>
   - [시각화 요소 예시 2 - 지출 비교 및 도넛형 conic-gradient 차트]:
     <div style="display: flex; justify-content: center; margin: 16px 0; gap: 20px; align-items: center; background: var(--glass-bg); padding: 16px; border-radius: 10px; border: 1px solid var(--glass-border);">
       <div style="width: 100px; height: 100px; border-radius: 50%; background: conic-gradient(#6366f1 0% 50%, #ec4899 50% 80%, #3b82f6 80% 100%); flex-shrink: 0;"></div>
       <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px; color: var(--text-secondary);">
         <div><span style="display:inline-block; width:10px; height:10px; background:#6366f1; border-radius:50%; margin-right:6px;"></span>🍔 식비: 50%</div>
         <div><span style="display:inline-block; width:10px; height:10px; background:#ec4899; border-radius:50%; margin-right:6px;"></span>🛍️ 쇼핑: 30%</div>
         <div><span style="display:inline-block; width:10px; height:10px; background:#3b82f6; border-radius:50%; margin-right:6px;"></span>기타: 20%</div>
       </div>
     </div>
   - 각 카테고리별 디자인 색감 규칙:
     * 식비/생활비 계열: Indigo/Purple 그라데이션 (#6366f1, #a855f7)
     * 쇼핑/패션/여가 계열: Pink/Red 그라데이션 (#ec4899, #ef4444)
     * 교통/주거/공과금 계열: Blue/Cyan 그라데이션 (#3b82f6, #06b6d4)
     * 저축/수입 계열: Green/Teal 그라데이션 (#10b981, #14b8a6)
     * 기타: Grey 계열 (#94a3b8)
   
   - content 본문 내에 반드시 포함되어야 할 항목:
     - ## 📊 가계부 종합 요약: 이번 달 총 수입/지출 현황과 예산 준수율을 명확한 수치와 함께 요약하고, 전체 예산 대비 총 지출 현황을 가로 막대 그래프(Progress Bar)로 시각화해 주세요.
     - ## 🔍 주요 소비 카테고리 분석: 가장 높은 지출을 기록한 상위 3개 카테고리를 추출하여, 각각의 지출 비중과 금액을 세련된 가로 막대형 그래프와 분석 텍스트로 자세하게 작성해 주세요. (도넛형 conic-gradient 차트로 카테고리 간의 지출 분배를 요약하여 첨부해 주세요.)
     - ## ✨ 이번 달의 긍정적인 소비 습관: 이전 기간과 비교하여 절약했거나 예산 한도를 잘 지킨 현황을 짚고 칭찬해 주세요.
     - ## ⚠️ 개선 및 주의가 필요한 영역: 과도하게 지출된 부문, 충동 소비가 의심되는 카테고리를 날카롭게 지적하고 원인과 위험 요소를 짚어주세요.
     - ## 💡 다음 달 저축 및 예산 제안: 실천 가능한 다음 달 지출 한도 가이드라인, 구체적인 저축 목표액, 그리고 재정 건전성을 높이기 위한 스마트 예산 팁을 제공해 주세요.

예시 출력 형식:
{
  "summary": "온라인 쇼핑이 급증했으나 외식비를 아껴 전체 예산을 방어했습니다.",
  "content": "## 📊 가계부 종합 요약\\n이번 달 총 지출은...\\n<div style=\\"background: var(--glass-bg); ...\\n\\n## 🔍 주요 소비 카테고리 분석\\n- **외식비**: 지난 달 대비...\\n"
}
`;

  let responseText = '';
  try {
    const provider = config.provider || 'gemini';

    if (provider === 'gemini') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('Gemini API Key가 누락되었습니다.');

      const models = ['gemini-3.1-flash-lite'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json'
              }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
            responseText = data.candidates[0].content.parts[0].text;
            success = true;
            console.log(`[AI 소비리포트] Gemini 모델 ${model} 생성 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 소비리포트] Gemini 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('Gemini API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'openai') {
      const apiKey = config.apiKey;
      if (!apiKey) throw new Error('OpenAI API Key가 누락되었습니다.');

      const models = ['gpt-5.4-nano'];
      let success = false;
      let lastErr = null;

      for (const model of models) {
        try {
          const url = 'https://api.openai.com/v1/chat/completions';
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }],
              response_format: { type: 'json_object' }
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText}`);
          }

          const data = await res.json();
          if (data.choices && data.choices[0] && data.choices[0].message) {
            responseText = data.choices[0].message.content;
            success = true;
            console.log(`[AI 소비리포트] OpenAI 모델 ${model} 생성 성공`);
            break;
          }
        } catch (e) {
          lastErr = e;
          console.warn(`[AI 소비리포트] OpenAI 모델 ${model} 호출 실패, 폴백 시도:`, e.message);
        }
      }

      if (!success) {
        throw lastErr || new Error('OpenAI API 호출에 모두 실패했습니다.');
      }

    } else if (provider === 'local') {
      const localIp = config.localIp;
      const localModel = config.localModel || 'local-model';
      if (!localIp) throw new Error('로컬 OpenAI 호환 IP가 누락되었습니다.');

      const url = `${localIp}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: localModel,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        responseText = data.choices[0].message.content;
        console.log(`[AI 소비리포트] 로컬 OpenAI 호환 모델 ${localModel} 생성 성공`);
      } else {
        throw new Error('올바르지 않은 로컬 API 응답 형식입니다.');
      }
    }

    if (!responseText) {
      return null;
    }

    let jsonText = responseText.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const result = JSON.parse(jsonText);
    return {
      summary: (result.summary || '소비 분석이 완료되었습니다.').trim(),
      content: (result.content || '').trim()
    };

  } catch (err) {
    console.error('[AI 소비리포트 생성 오류]:', err.message);
    if (responseText) {
      return {
        summary: 'AI 소비 분석 리포트',
        content: responseText.trim()
      };
    }
    return null;
  }
}

module.exports = {
  parseNotificationWithAI,
  generatePatternWithAI,
  generateConsumptionReportWithAI
};
