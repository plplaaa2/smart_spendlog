/**
 * @file routes/transactions.js
 * @summary 거래 내역 및 카테고리/결제수단 관리 API 라우터
 * @description 가계부 내역(Transactions)의 CRUD 및 사용처 자동 매핑(merchant_categories), 프랜차이즈 프리셋 일괄 파싱 학습 기능을 포함합니다.
 * @dependencies
 *   - database.js: getDB, updateHASensors, seedFranchisePresets, FRANCHISE_PRESETS
 */

const express = require('express');
const router = express.Router();
const { getDB, updateHASensors, seedFranchisePresets, FRANCHISE_PRESETS } = require('../database');

// 가계부 내역 조회 (필터 포함)
router.get('/transactions', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { month, category, search, pay_method, type } = req.query;
    
    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params = [];

    if (month) {
      query += ' AND datetime LIKE ?';
      params.push(`${month}%`);
    }

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (merchant LIKE ? OR memo LIKE ? OR raw_text LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (pay_method) {
      query += ' AND pay_method = ?';
      params.push(pay_method);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY datetime DESC, id DESC';
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 가계부 수동 등록 및 수정
router.post('/transactions', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { id, type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point, package: packageVal } = req.body;

    if (!amount || !merchant || !datetime) {
      return res.status(400).json({ error: '금액, 사용처, 일시는 필수 값입니다.' });
    }

    const txType = type || 'EXPENSE';
    const txUsedPoint = parseInt(used_point, 10) || 0;

    // 패키지별 결제수단 자동 매핑 처리 (패키지 매핑이 있으면 최우선 적용, 없으면 규칙/파싱 결과 적용)
    let finalPayMethod = pay_method;
    if (packageVal) {
      const mappedPayMethodRow = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [packageVal]);
      if (mappedPayMethodRow && mappedPayMethodRow.pay_method) {
        finalPayMethod = mappedPayMethodRow.pay_method;
      }
    }

    if (finalPayMethod === '_AUTO_MAPPING_') {
      finalPayMethod = '카드';
    }

    if (id) {
      // 수정
      await db.run(
        'UPDATE transactions SET type = ?, amount = ?, merchant = ?, category = ?, pay_method = ?, datetime = ?, memo = ?, raw_text = ?, used_point = ? WHERE id = ?',
        [txType, amount, merchant, category, finalPayMethod, datetime, memo, raw_text, txUsedPoint, id]
      );

      // 사용처별 카테고리 자동 학습/매핑 업데이트 (지출건만)
      if (merchant && category && txType === 'EXPENSE') {
        await db.run('INSERT OR REPLACE INTO merchant_categories (merchant, category) VALUES (?, ?)', [merchant, category]);
      }

      res.json({ success: true, id });
      updateHASensors(req.username);
    } else {
      // 신규 등록
      const result = await db.run(
        'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txType, amount, merchant, category, finalPayMethod, datetime, memo, raw_text || '수동 입력', txUsedPoint]
      );

      // 사용처별 카테고리 자동 학습/매핑 업데이트 (지출건만)
      if (merchant && category && txType === 'EXPENSE') {
        await db.run('INSERT OR REPLACE INTO merchant_categories (merchant, category) VALUES (?, ?)', [merchant, category]);
      }

      res.json({ success: true, id: result.lastID });
      updateHASensors(req.username);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 가계부 내역 삭제
router.delete('/transactions/:id', async (req, res) => {
  try {
    const db = await getDB(req.username);
    await db.run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
    updateHASensors(req.username);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카테고리 목록 조회
router.get('/categories', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM categories ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카테고리 추가
// 의존성: public/app.js의 metadata 로드 및 index.html의 카테고리 폼과 연동됩니다.
router.post('/categories', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { name, color, icon, type } = req.body;
    if (!name) return res.status(400).json({ error: '카테고리명은 필수입니다.' });

    await db.run('INSERT OR IGNORE INTO categories (name, color, icon, type) VALUES (?, ?, ?, ?)', [name, color || '#868e96', icon || 'tag', type || 'EXPENSE']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 결제수단 조회
router.get('/pay_methods', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM pay_methods ORDER BY id ASC');
    const orderRow = await db.get("SELECT value FROM settings WHERE key = 'pay_methods_order'");
    if (orderRow && orderRow.value) {
      try {
        const order = JSON.parse(orderRow.value);
        if (Array.isArray(order)) {
          rows.sort((a, b) => {
            let indexA = order.indexOf(a.name);
            let indexB = order.indexOf(b.name);
            if (indexA === -1) indexA = 9999;
            if (indexB === -1) indexB = 9999;
            return indexA - indexB;
          });
        }
      } catch (e) {}
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 결제수단 추가
router.post('/pay_methods', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '결제수단명은 필수입니다.' });

    await db.run('INSERT OR IGNORE INTO pay_methods (name) VALUES (?)', [name]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 사용처별 카테고리 매핑 조회
router.get('/merchant_categories', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all('SELECT * FROM merchant_categories ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 사용처별 카테고리 매핑 등록 및 수정
router.post('/merchant_categories', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { id, merchant, category } = req.body;

    if (!merchant || !category) {
      return res.status(400).json({ error: '사용처명과 카테고리명은 필수 값입니다.' });
    }

    if (id) {
      await db.run(
        'UPDATE merchant_categories SET merchant = ?, category = ? WHERE id = ?',
        [merchant, category, id]
      );
      res.json({ success: true, id });
    } else {
      const result = await db.run(
        'INSERT OR REPLACE INTO merchant_categories (merchant, category) VALUES (?, ?)',
        [merchant, category]
      );
      res.json({ success: true, id: result.lastID });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 사용처별 카테고리 매핑 삭제
router.delete('/merchant_categories/:id', async (req, res) => {
  try {
    const db = await getDB(req.username);
    await db.run('DELETE FROM merchant_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 프랜차이즈 프리셋 일괄 적용 API
router.post('/merchant_categories/seed-presets', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const force = req.query.force === 'true' || (req.body && req.body.force === true);
    const result = await seedFranchisePresets(db, force);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 프리셋 목록 조회 API
router.get('/merchant_categories/presets', async (req, res) => {
  try {
    res.json(FRANCHISE_PRESETS);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
