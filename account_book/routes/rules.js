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
const { parseNotification, generatePatternFromText } = require('../parser');

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
    const { id, name, pattern, category, pay_method, merchant_template, type } = req.body;

    if (!name || !pattern) {
      return res.status(400).json({ error: '규칙 이름과 정규식 패턴은 필수 값입니다.' });
    }

    const ruleType = type || 'EXPENSE';
    const ruleCategory = category || '_AUTO_MAPPING_';

    if (id) {
      await db.run(
        'UPDATE rules SET name = ?, pattern = ?, category = ?, pay_method = ?, merchant_template = ?, type = ? WHERE id = ?',
        [name, pattern, ruleCategory, pay_method, merchant_template, ruleType, id]
      );
      res.json({ success: true, id });
    } else {
      const result = await db.run(
        'INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)',
        [name, pattern, ruleCategory, pay_method, merchant_template, ruleType]
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
    const { package: pkgName, pay_method } = req.body;

    if (!pkgName || !pay_method) {
      return res.status(400).json({ error: '패키지명과 결제수단명은 필수 값입니다.' });
    }

    const result = await db.run(
      'INSERT OR REPLACE INTO package_pay_methods (package, pay_method) VALUES (?, ?)',
      [pkgName, pay_method]
    );
    res.json({ success: true, id: result.lastID });
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
    const { text, pattern, category, pay_method, type, merchant_template } = req.body;
    if (!text || !pattern) {
      return res.status(400).json({ error: '테스트 문자열과 정규식 패턴은 필수 값입니다.' });
    }

    const rules = [{ id: 999, name: '테스트 규칙', pattern, category, pay_method, merchant_template, type }];
    const result = parseNotification(text, rules);

    if (result) {
      const db = await getDB(req.username);
      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      const finalCategory = matchedCategory || '기타';
      res.json({ success: true, result: { ...result, category: finalCategory } });
    } else {
      res.json({ success: false, message: '정규식 패턴이 문자열과 일치하지 않습니다.' });
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

    if (log.parsed_status === 'SUCCESS') {
      return res.status(400).json({ error: '이미 파싱 성공한 로그입니다.' });
    }

    const rawText = log.raw_text;
    const title = log.title || '';
    const text = log.text || '';
    const sender = log.sender || 'Unknown';

    const adminDb = await getDB('admin');
    const rules = await adminDb.all('SELECT * FROM rules');
    let result = parseNotification(rawText, rules);

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
          const merchantName = (tempParsed && tempParsed.merchant) ? tempParsed.merchant : '자동 생성 규칙';
          
          const insertRes = await adminDb.run(
            "INSERT INTO rules (name, pattern, category, pay_method, merchant_template, type) VALUES (?, ?, ?, ?, ?, ?)",
            [merchantName, generatedPattern, '_AUTO_MAPPING_', '_AUTO_MAPPING_', '${merchant}', resultType]
          );
          matchedRuleId = insertRes.lastID;
          
          console.log(`[로그재시도][자동규칙생성][${targetUser}] 알림 파싱 실패로 인해 새 규칙을 자동 생성했습니다: "${merchantName}" (ID: ${matchedRuleId})`);
          
          const updatedRules = await adminDb.all('SELECT * FROM rules');
          result = parseNotification(rawText, updatedRules);
        }
      }
    }

    if (result) {
      parsedStatus = 'SUCCESS';
      matchedRuleId = result.rule_id || matchedRuleId;

      const matchedCategory = await findCategoryByMerchant(db, result.merchant);
      let finalCategory = matchedCategory || '기타';

      let finalPayMethod = result.pay_method;
      if (finalPayMethod === '_AUTO_MAPPING_') {
        if (sender && sender !== 'Unknown') {
          const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [sender]);
          if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
            finalPayMethod = mappedPayMethodRow.pay_method;
          } else {
            finalPayMethod = '카드';
          }
        } else {
          finalPayMethod = '카드';
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
                                 ['입금', '이체', '송금', '출금', '대체'].includes(result.merchant) ||
                                 isKoreanName(result.merchant);

      if (isTransferMerchant && isBank) {
        if (result.type === 'INCOME') {
          finalCategory = '이체/입금';
        } else {
          finalCategory = '이체/송금';
        }
        console.log(`[로그재시도][${targetUser}] 통장 이동(자산 이동) 감지: 카테고리를 '${finalCategory}'으로 강제 변경하여 등록합니다.`);
      }

      // 가계부 내역에 추가
      await db.run(
        'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [result.type || 'EXPENSE', result.amount, result.merchant, finalCategory, finalPayMethod, result.datetime, result.memo || '', rawText, result.used_point || 0]
      );

      // 로그 상태 업데이트
      await db.run(
        'UPDATE notification_logs SET parsed_status = ?, matched_rule_id = ? WHERE id = ?',
        [parsedStatus, matchedRuleId, logId]
      );

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
