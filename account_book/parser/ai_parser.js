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
- "amount" (integer): The transaction amount.
- "merchant" (string): The merchant, sender, or receiver name. Keep it clean (e.g. extract "이마트" from "이마트 신도림점").
- "datetime" (string): Format: "YYYY-MM-DD HH:mm:ss". Use the transaction time from the text. If the year is not mentioned, use the current year from fallback date: ${resolvedFallback}. If no date/time is mentioned, use fallback date: ${resolvedFallback}.
- "pay_method" (string): The payment method name (e.g., "KB국민체크", "신한카드", "토스", "농협" etc.).
- "type" (string): "EXPENSE" for spending/outflow, "INCOME" for deposit/inflow.

Notification Text: "${cleanText}"
Fallback Date: "${resolvedFallback}"

Example Output:
{
  "amount": 12500,
  "merchant": "스타벅스",
  "datetime": "2026-06-02 14:30:00",
  "pay_method": "신한카드",
  "type": "EXPENSE"
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

    return {
      amount: parseInt(result.amount, 10),
      merchant: (result.merchant || '알수없음').trim(),
      datetime: result.datetime || resolvedFallback,
      pay_method: (result.pay_method || '카드').trim(),
      type: result.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
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

CRITICAL RULE FOR NEWLINES/SPACES:
DO NOT use raw newlines (\\n or \\r\\n) in the pattern. Instead, use \\\\s+ or \\\\s* to match line breaks and whitespaces to make the pattern platform-independent.

CRITICAL RULE FOR CURRENCY SYMBOLS:
If currency symbols like ₩, $, or \\ are present in the amount, ensure the pattern matches them outside or inside the group appropriately (e.g. \\\\(?<amount>[\\\\d,]+) or ₩(?<amount>[\\\\d,]+)).

The pattern MUST match the entire text or its major part. Escape bracket characters properly (e.g. \\[KB국민\\]).
Notice that double backslashes should be used since it will be parsed as JSON.

Notification Text: "${cleanText}"

You MUST output the result ONLY as a JSON object, without markdown formatting or code blocks.
The JSON object MUST contain exactly one field:
- "pattern" (string): The constructed RegExp pattern.

Example Output:
{
  "pattern": "\\\\[KB국민체크\\\\]\\\\s*(?<time>\\\\d{2}/\\\\d{2}\\\\s+\\\\d{2}:\\\\d{2})\\\\s+(?<amount>[\\\\d,]+)원\\\\s+(?<merchant>.+?)\\\\s+승인"
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
    return result.pattern || null;

  } catch (err) {
    console.error('[AI 패턴빌더 오류]:', err.message);
    return null;
  }
}

async function generateConsumptionReportWithAI(dataText, config) {
  if (!dataText || !config) return null;

  const prompt = `당신은 대한민국 최고의 금융 분석가이자 개인 자산 관리 코치입니다.
사용자의 가계부 통계 데이터를 심층적으로 분석하여, 현재 소비 성향을 진단하고 실용적이고 구체적인 재정 피드백 리포트를 마크다운(Markdown) 형식으로 생성해 주세요.

[분석 대상 통계 데이터]
${dataText}

[작성 및 출력 규칙]
1. 반드시 한국어로 정중하게 작성해 주십시오. (존댓말 사용)
2. 출력은 반드시 다음과 같은 JSON 객체 하나만 반환해야 하며, 마크다운 코드 블록이나 기타 텍스트 설명은 절대로 덧붙이지 마십시오. (JSON 순수 텍스트만 출력)
{
  "summary": "가계의 현재 소비 요약 한 줄 평 (예: '이번 달은 온라인 쇼핑 지출이 평소보다 25% 늘어났지만, 고정 지출을 성공적으로 통제한 한 달입니다.')",
  "content": "여기에 상세한 마크다운 리포트 본문 텍스트를 기재하십시오. 줄바꿈은 \\n 으로 이스케이프해야 합니다."
}

3. content (마크다운 리포트 본문)에 반드시 포함되어야 할 항목:
   - ## 📊 가계부 종합 요약: 수입과 지출의 균형, 예산 준수율 등을 명확한 수치와 함께 요약.
   - ## 🔍 주요 소비 카테고리 분석: 가장 높은 지출을 차지한 상위 3개 카테고리에 대한 지출 요인 분석.
   - ## ✨ 이번 달의 긍정적인 소비 습관: 이전 대비 절약했거나 잘한 부분 칭찬.
   - ## ⚠️ 개선 및 주의가 필요한 영역: 충동 소비 경향이 있거나 불필요하게 낭비된 부문 지적.
   - ## 💡 다음 달 저축 및 예산 제안: 실현 가능한 저축액 목표 제시 및 예산 최적화 팁 제안.

예시 출력 형식:
{
  "summary": "온라인 쇼핑이 급증했으나 외식비를 아껴 전체 예산을 방어했습니다.",
  "content": "## 📊 가계부 종합 요약\\n이번 달 총 지출은...\\n\\n## 🔍 주요 소비 카테고리 분석\\n- **외식비**: 지난 달 대비...\\n"
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
