/**
 * @file routes/rules.js
 * @summary 알림 파싱 정규식 규칙 및 수신 로그 관리 API 라우터
 * @description 카드 문자 자동 분류를 위한 정규식 규칙 CRUD, 실시간 파싱 테스트, 앱 패키지명 결제수단 매핑 및 미처리 알림 로그 관리를 담당합니다.
 * @dependencies
 *   - database.js: getDB
 *   - parser.js: parseNotification
 */

const express = require('express');
const router = express.Router();
const { getDB, findCategoryByMerchant, updateHASensors } = require('../database');
const { parseNotification, generatePatternFromText, generatePatternWithAI, sanitizePattern } = require('../parser');
const cryptoHelper = require('../crypto_helper');

// SQLite UTC 날짜 문자열(YYYY-MM-DD HH:mm:ss)을 KST 로컬 시각 문자열로 변환하는 헬퍼 함수
function convertUTCToKSTString(utcStr) {
  if (!utcStr) return '';
  const cleanStr = utcStr.replace(/-/g, '/') + ' UTC';
  const dateObj = new Date(cleanStr);
  if (isNaN(dateObj.getTime())) {
    return utcStr;
  }
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstDate = new Date(dateObj.getTime() + kstOffset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())} ${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`;
}

// 규칙 테이블의 name UNIQUE 제약 조건 충돌 방지를 위해 중복 시 숫자를 붙여 유니크한 규칙 이름을 만드는 헬퍼 함수
async function getUniqueRuleName(db, baseName) {
  let name = baseName;
  let counter = 1;
  while (true) {
    const row = await db.get('SELECT id FROM rules WHERE name = ?', [name]);
    if (!row) {
      return name;
    }
    counter++;
    name = `${baseName} (${counter})`;
  }
}

// 프랜차이즈 프리셋 데이터 조회 (규칙 패턴 자동 생성 시 가중치 계산용)
router.get('/rules/presets', async (req, res) => {
  try {
    const presets = require('../franchise_presets').FRANCHISE_PRESETS || [];
    res.json(presets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 규칙 조회 (모든 사용자가 admin의 규칙을 공유하여 동일하게 적용)
router.get('/rules', async (req, res) => {
  try {
    const db = await getDB('admin');
    const rows = await db.all('SELECT * FROM rules ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 규칙 등록 및 수정
router.post('/rules', async (req, res) => {
  try {
    const db = await getDB('admin');
    const { id, name, pattern, category, pay_method, pay_type, merchant_template, type } = req.body;

    if (!name || !pattern) {
      return res.status(400).json({ error: '규칙 이름과 정규식 패턴은 필수 값입니다.' });
    }

    try {
      new RegExp(sanitizePattern(pattern), 'ds');
    } catch (regexErr) {
      return res.status(400).json({ error: `올바르지 않은 정규식 패턴 형식입니다: ${regexErr.message}` });
    }

    const ruleType = type || 'EXPENSE';
    const ruleCategory = category || '_AUTO_MAPPING_';
    const rulePayType = pay_type || 'CREDIT';

    if (id) {
      const existsInRules = await db.get('SELECT id FROM rules WHERE id = ?', [id]);
      if (existsInRules) {
        await db.run(
          'UPDATE rules SET name = ?, pattern = ?, category = ?, pay_method = ?, pay_type = ?, merchant_template = ?, type = ? WHERE id = ?',
          [name, pattern, ruleCategory, pay_method, rulePayType, merchant_template, ruleType, id]
        );
        res.json({ success: true, id });
      } else {
        // 기존 패스규칙(pass_rules)에서 전환된 경우
        await db.run('DELETE FROM pass_rules WHERE id = ?', [id]);
        const result = await db.run(
          'INSERT INTO rules (name, pattern, category, pay_method, pay_type, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, pattern, ruleCategory, pay_method, rulePayType, merchant_template, ruleType]
        );
        res.json({ success: true, id: result.lastID });
      }
    } else {
      const result = await db.run(
        'INSERT INTO rules (name, pattern, category, pay_method, pay_type, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, pattern, ruleCategory, pay_method, rulePayType, merchant_template, ruleType]
      );
      res.json({ success: true, id: result.lastID });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 규칙 삭제
router.delete('/rules/:id', async (req, res) => {
  try {
    const db = await getDB('admin');
    await db.run('DELETE FROM rules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패스규칙 조회 (모든 사용자가 admin의 패스규칙을 공유하여 동일하게 적용)
router.get('/pass_rules', async (req, res) => {
  try {
    const db = await getDB('admin');
    const rows = await db.all('SELECT * FROM pass_rules ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패스규칙 등록 및 수정
router.post('/pass_rules', async (req, res) => {
  try {
    const db = await getDB('admin');
    const { id, name, pattern } = req.body;

    if (!name || !pattern) {
      return res.status(400).json({ error: '패스규칙 이름과 정규식 패턴은 필수 값입니다.' });
    }

    try {
      new RegExp(sanitizePattern(pattern));
    } catch (regexErr) {
      return res.status(400).json({ error: `올바르지 않은 정규식 패턴 형식입니다: ${regexErr.message}` });
    }

    if (id) {
      const existsInPass = await db.get('SELECT id FROM pass_rules WHERE id = ?', [id]);
      if (existsInPass) {
        await db.run(
          'UPDATE pass_rules SET name = ?, pattern = ? WHERE id = ?',
          [name, pattern, id]
        );
        res.json({ success: true, id });
      } else {
        // 기존 일반분류규칙(rules)에서 전환된 경우
        await db.run('DELETE FROM rules WHERE id = ?', [id]);
        const result = await db.run(
          'INSERT INTO pass_rules (name, pattern) VALUES (?, ?)',
          [name, pattern]
        );
        res.json({ success: true, id: result.lastID });
      }
    } else {
      const result = await db.run(
        'INSERT INTO pass_rules (name, pattern) VALUES (?, ?)',
        [name, pattern]
      );
      res.json({ success: true, id: result.lastID });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패스규칙 삭제
router.delete('/pass_rules/:id', async (req, res) => {
  try {
    const db = await getDB('admin');
    await db.run('DELETE FROM pass_rules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패키지별 결제수단 매핑 조회
router.get('/package_pay_methods', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM package_pay_methods ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패키지별 결제수단 매핑 추가 및 수정
router.post('/package_pay_methods', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { id, package: pkgName, pay_method } = req.body;

    if (!pkgName || !pay_method) {
      return res.status(400).json({ error: '패키지명과 결제수단명은 필수 값입니다.' });
    }

    if (id) {
      await db.run(
        'UPDATE package_pay_methods SET package = ?, pay_method = ? WHERE id = ?',
        [pkgName, pay_method, id]
      );
      res.json({ success: true, id });
    } else {
      const result = await db.run(
        'INSERT OR REPLACE INTO package_pay_methods (package, pay_method) VALUES (?, ?)',
        [pkgName, pay_method]
      );
      res.json({ success: true, id: result.lastID });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 패키지별 결제수단 매핑 삭제
router.delete('/package_pay_methods/:id', async (req, res) => {
  try {
    const db = await getDB(req.username);
    await db.run('DELETE FROM package_pay_methods WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 수신 알림 로그 조회
router.get('/notification_logs', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM notification_logs ORDER BY id DESC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 정규식 파싱 테스트 API
// 요약: 정규식 패턴 작성 시 실시간 테스트를 위해 결제유형, 결제수단, 카테고리를 반영해 파싱 결과를 시뮬레이션하고, 자동 매핑 시 DB 조회를 연계합니다.
// 의존성: database.js의 findCategoryByMerchant를 활용하여 카테고리 자동 매핑 결과를 가상 도출합니다.
router.post('/parse-test', async (req, res) => {
  try {
    const { text, pattern, category, pay_method, pay_type, type, merchant_template } = req.body;
    if (!text || !pattern) {
      return res.status(400).json({ error: '테스트 문자열과 정규식 패턴은 필수 값입니다.' });
    }

    const rules = [{ id: 999, name: '테스트 규칙', pattern, category, pay_method, pay_type, merchant_template, type }];
    const result = parseNotification(text, rules);

    if (result) {
      const db = await getDB(req.username);
      let finalCategory = result.category;
      if (!finalCategory || finalCategory === '_AUTO_MAPPING_') {
        const matchedCategory = await findCategoryByMerchant(db, result.merchant);
        finalCategory = matchedCategory;
      }
      if (!finalCategory) {
        finalCategory = '기타';
      }
      res.json({ success: true, result: { ...result, category: finalCategory } });
    } else {
      res.json({ success: false, message: '정규식 패턴이 문자열과 일치하지 않습니다.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 기반 정규식 패턴 생성 API
router.post('/rules/ai-generate', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '분석할 알림 내용이 필요합니다.' });
    }
    
    const db = await getDB(req.username);
    const settingsList = await db.all("SELECT key, value FROM settings WHERE key IN ('ai_enabled', 'ai_parsing_enabled', 'ai_provider', 'ai_api_key', 'ai_local_ip', 'ai_local_model')");
    const settings = {};
    settingsList.forEach(row => {
      settings[row.key] = row.value;
    });
    
    if (settings.ai_enabled !== 'true') {
      return res.status(400).json({ error: 'AI 기능이 비활성화 상태입니다. 설정 탭의 AI 설정에서 먼저 활성화해 주세요.' });
    }
    
    const provider = settings.ai_provider || 'gemini';
    let apiKey = settings.ai_api_key;
    if (apiKey && (provider === 'gemini' || provider === 'openai')) {
      try {
        apiKey = cryptoHelper.decrypt(apiKey);
      } catch (decErr) {
        console.error('[AI 패턴 빌더] API Key 복호화 실패:', decErr.message);
      }
    }
    
    const aiConfig = {
      provider,
      apiKey,
      localIp: settings.ai_local_ip,
      localModel: settings.ai_local_model
    };
    
    const aiResult = await generatePatternWithAI(text, aiConfig);
    if (aiResult && aiResult.pattern) {
      res.json({ 
        success: true, 
        pattern: aiResult.pattern,
        pay_method: aiResult.pay_method,
        pay_type: aiResult.pay_type,
        type: aiResult.type
      });
    } else {
      res.status(500).json({ error: 'AI를 통한 정규식 패턴 생성에 실패했습니다.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 알림 수신로그 개별 재시도 API (인증 필요 라우터 영역)
router.post('/notification_logs/:id/retry', async (req, res) => {
  const logId = req.params.id;
  const targetUser = req.username || 'admin';

  try {
    const db = await getDB(targetUser);
    const log = await db.get('SELECT * FROM notification_logs WHERE id = ?', [logId]);

    if (!log) {
      return res.status(404).json({ error: '해당 알림 로그를 찾을 수 없습니다.' });
    }

    const rawText = log.raw_text;
    const title = log.title || '';
    const text = log.text || '';
    const sender = log.sender || 'Unknown';

    const adminDb = await getDB('admin');
    const rules = await adminDb.all('SELECT * FROM rules');
    const logKSTTime = convertUTCToKSTString(log.created_at);
    let result = parseNotification(rawText, rules, logKSTTime);

    let parsedStatus = 'FAILED';
    let matchedRuleId = null;

    if (!result) {
      const autoRuleRow = await db.get("SELECT value FROM settings WHERE key = 'auto_rule_generation'");
      const isAutoRuleEnabled = autoRuleRow && autoRuleRow.value === 'true';

      if (isAutoRuleEnabled) {
        const generatedPattern = generatePatternFromText(rawText);
        if (generatedPattern) {
          const isIncome = /입금|저축|환불|입금완료|수입/.test(rawText);
          const resultType = isIncome ? 'INCOME' : 'EXPENSE';
          
          const dummyRule = { 
            pattern: generatedPattern, 
            pay_method: '_AUTO_MAPPING_', 
            category: '_AUTO_MAPPING_', 
            type: resultType, 
            id: 9999, 
            name: '임시' 
          };
          const tempParsed = parseNotification(rawText, [dummyRule]);
          const parsedMerchant = (tempParsed && tempParsed.merchant) ? tempParsed.merchant : '자동 생성 규칙';
          let suffix = '지출';
          if (resultType === 'INCOME') {
            suffix = '수입';
          } else {
            if (rawText.includes('체크')) {
              suffix = '체크';
            } else if (rawText.includes('신용') || rawText.includes('카드')) {
              suffix = '신용';
            }
          }
          const baseRuleName = `${parsedMerchant} ${suffix}`;
          const ruleName = await getUniqueRuleName(adminDb, baseRuleName);
          
          const insertRes = await adminDb.run(
            "INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
            [ruleName, generatedPattern, '_AUTO_MAPPING_', '_AUTO_MAPPING_', '${merchant}', resultType]
          );
          matchedRuleId = insertRes.lastID;
          
          console.log(`[로그재시도][자동규칙생성][${targetUser}] 알림 파싱 실패로 인해 새 규칙을 자동 생성했습니다: "${ruleName}" (ID: ${matchedRuleId})`);
          
          const updatedRules = await adminDb.all('SELECT * FROM rules');
          result = parseNotification(rawText, updatedRules, logKSTTime);
        }
      }
    }

    if (result) {
      parsedStatus = 'SUCCESS';
      matchedRuleId = result.rule_id || matchedRuleId;

      // 패키지별 결제수단 자동 매핑 (패키지 매핑이 있으면 최우선 적용, 없으면 규칙/파싱 결과 적용)
      let finalPayMethod = result.pay_method;
      if (sender && sender !== 'Unknown') {
        const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [sender]);
        if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
          finalPayMethod = mappedPayMethodRow.pay_method;
        }
      }

      if (finalPayMethod === '_AUTO_MAPPING_') {
        finalPayMethod = '카드';
      }

      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      let finalCategory = matchedCategory;
      if (!finalCategory) {
        if (result.type === 'INCOME') {
          finalCategory = '기타수입';
        } else {
          const lowerMerchant = result.merchant.toLowerCase();
          const isPayCharge = lowerMerchant.includes('페이충전') || 
                               lowerMerchant.includes('페이 충전') || 
                               lowerMerchant.includes('페이머니') || 
                               lowerMerchant.includes('네이버페이') || 
                               lowerMerchant.includes('카카오페이') || 
                               lowerMerchant.includes('토스페이') || 
                               lowerMerchant.includes('토스머니');
          const isPayMethod = (finalPayMethod.includes('페이') || finalPayMethod.includes('머니')) && !finalPayMethod.includes('삼성페이');
          finalCategory = (isPayCharge || isPayMethod) ? '페이류' : '기타';
        }
      }

      // 통장 이동(자산 이동) 감지 및 강제 카테고리 매핑
      const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
      const realName = realNameRow ? realNameRow.value.trim() : '';
      const isBank = finalPayMethod.includes('은행') || finalPayMethod.includes('뱅크') || finalPayMethod.includes('농협') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(finalPayMethod);
      
      const isKoreanName = (name) => {
        if (!name) return false;
        const clean = name.trim();
        const singleLastNames = '김이박최정강조윤장임한오서신권황안송전홍유육설배고문손양백허소남심노하곽성차구우주민진지채원천방공현함변염여추도석마가기길나단탁국';
        const doubleLastNames = ['남궁', '독고', '황보', '사공', '선우', '동방', '제갈', '서문'];
        if (clean.length === 3 && singleLastNames.includes(clean[0]) && /^[가-힣]{3}$/.test(clean)) {
          return true;
        }
        if (clean.length === 4 && doubleLastNames.includes(clean.slice(0, 2)) && /^[가-힣]{4}$/.test(clean)) {
          return true;
        }
        return false;
      };
      
      const isTransferMerchant = (realName && result.merchant === realName) || 
                                 ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant);

      if (isTransferMerchant && isBank) {
        if (result.type === 'INCOME') {
          finalCategory = '이체/입금';
        } else {
          finalCategory = '이체/송금';
        }
        console.log(`[로그재시도][${targetUser}] 통장 이동(자산 이동) 감지: 카테고리를 '${finalCategory}'으로 강제 변경하여 등록합니다.`);
      }

      // Replace the previous transaction only after parsing and enrichment succeed.
      // Related data: transactions.raw_text and notification_logs.matched_rule_id.
      await db.run('BEGIN TRANSACTION');
      try {
        await db.run('DELETE FROM transactions WHERE raw_text = ?', [rawText]);
        await db.run(
          'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [result.type || 'EXPENSE', result.amount, result.merchant, finalCategory, finalPayMethod, result.datetime, result.memo || '', rawText, result.used_point || 0]
        );
        await db.run(
          'UPDATE notification_logs SET parsed_status = ?, matched_rule_id = ? WHERE id = ?',
          [parsedStatus, matchedRuleId, logId]
        );
        await db.run('COMMIT');
      } catch (replaceErr) {
        try {
          await db.run('ROLLBACK');
        } catch (rollbackErr) {
          console.error(`[로그재시도][${targetUser}] 거래 교체 롤백 실패:`, rollbackErr.message);
        }
        throw replaceErr;
      }

      updateHASensors(targetUser);

      return res.json({ success: true, message: '알림 재시도 및 가계부 등록 완료', transaction: { merchant: result.merchant, amount: result.amount } });
    } else {
      return res.status(400).json({ error: '여전히 알림을 분석할 수 있는 매칭 규칙이 없습니다.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
