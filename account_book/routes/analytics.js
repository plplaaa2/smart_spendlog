/**
 * @file routes/analytics.js
 * @summary 월별/연도별 소비 트렌드 및 통계 연산 API 라우터
 * @description 가계부 대시보드 통계 및 자산별 잔액/남은 지원금 포인트(used_point 기반) 계산, 전월/전년 동월 대비 소비 흐름을 분석합니다.
 * @dependencies
 *   - database.js: getDB
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../database');

// 통계 API (대시보드 메인 화면)
router.get('/stats', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { month } = req.query; // YYYY-MM 포맷

    if (!month) {
      return res.status(400).json({ error: '조회할 월(month)을 지정해 주세요.' });
    }

    // 1. 월 총 지출액 및 총 수입액 (이체 제외)
    const totalRow = await db.get(
      "SELECT SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
      "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
      "FROM transactions WHERE datetime LIKE ?", 
      [`${month}%`]
    );
    const totalExpense = totalRow.expense || 0;
    const totalIncome = totalRow.income || 0;

    // 2. 카테고리별 지출액 및 비중 (지출 타입만 집계, 이체/송금 제외)
    const categoryRows = await db.all(
      "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' GROUP BY category ORDER BY total DESC",
      [`${month}%`]
    );

    // 3. 일자별 지출 및 수입 추이 (이체 제외)
    const dailyRows = await db.all(
      "SELECT substr(datetime, 1, 10) as date, " +
      "SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
      "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
      "FROM transactions WHERE datetime LIKE ? GROUP BY date ORDER BY date ASC",
      [`${month}%`]
    );

    // 4. 예산 설정 조회
    const budgetRow = await db.get("SELECT value FROM settings WHERE key = 'monthly_budget'");
    const budget = budgetRow ? parseInt(budgetRow.value, 10) : 500000;

    // 5. 최근 6개월간 월별 지출/수입 흐름 (트렌드 차트용, 이체 제외)
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const targetMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const trendRow = await db.get(
        "SELECT SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense, " +
        "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income " +
        "FROM transactions WHERE datetime LIKE ?", 
        [`${targetMonth}%`]
      );
      monthlyTrend.push({
        month: targetMonth,
        expense: trendRow.expense || 0,
        income: trendRow.income || 0
      });
    }

    // 6. 결제 수단별(은행/카드) 통계 및 잔액 계산
    const payMethods = await db.all('SELECT name FROM pay_methods ORDER BY id ASC');
    const orderRow = await db.get("SELECT value FROM settings WHERE key = 'pay_methods_order'");
    if (orderRow && orderRow.value) {
      try {
        const order = JSON.parse(orderRow.value);
        if (Array.isArray(order)) {
          payMethods.sort((a, b) => {
            let indexA = order.indexOf(a.name);
            let indexB = order.indexOf(b.name);
            if (indexA === -1) indexA = 9999;
            if (indexB === -1) indexB = 9999;
            return indexA - indexB;
          });
        }
      } catch (e) {}
    }
    
    // 초기 잔액 설정 읽기
    const balancesRow = await db.get("SELECT value FROM settings WHERE key = 'initial_balances'");
    let initialBalances = {};
    if (balancesRow && balancesRow.value) {
      try {
        initialBalances = JSON.parse(balancesRow.value);
      } catch (e) {
        initialBalances = {};
      }
    }

    // 초기 포인트(지원금) 설정 읽기
    const pointsRow = await db.get("SELECT value FROM settings WHERE key = 'initial_points'");
    let initialPoints = {};
    if (pointsRow && pointsRow.value) {
      try {
        initialPoints = JSON.parse(pointsRow.value);
      } catch (e) {
        initialPoints = {};
      }
    }

    // 전체 누적 입출금 및 사용 포인트
    const allTimeRows = await db.all(
      "SELECT pay_method, " +
      "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as total_income, " +
      "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as total_expense, " +
      "SUM(COALESCE(used_point, 0)) as total_used_point " +
      "FROM transactions GROUP BY pay_method"
    );
    const allTimeMap = {};
    allTimeRows.forEach(r => {
      if (r.pay_method) {
        allTimeMap[r.pay_method] = {
          totalIncome: r.total_income || 0,
          totalExpense: r.total_expense || 0,
          totalUsedPoint: r.total_used_point || 0
        };
      }
    });

    // 해당 월 입출금
    const monthRows = await db.all(
      "SELECT pay_method, " +
      "SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
      "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
      "FROM transactions WHERE datetime LIKE ? GROUP BY pay_method",
      [`${month}%`]
    );
    const monthMap = {};
    monthRows.forEach(r => {
      if (r.pay_method) {
        monthMap[r.pay_method] = {
          monthIncome: r.month_income || 0,
          monthExpense: r.month_expense || 0
        };
      }
    });

    const assets = [];
    for (const m of payMethods) {
      const name = m.name;
      
      // 제외할 일반 명칭 및 범주명
      if (name === '계좌이체' || name === '신용카드' || name === '체크카드') {
        continue;
      }
      
      const isCard = name.includes('카드') || name.includes('페이') || name.includes('머니'); // 카드, 페이, 머니류는 잔고 제외 (소비로 분류)
      // 카드가 아닌 모든 결제수단(계좌이체 제외)은 자산으로 유연하게 판정하여 누락 방지
      const isAsset = !isCard && name !== '계좌이체';
                      
      // 카드나 자산 중 어느 하나에도 해당하지 않는 결제수단은 제외
      if (!isCard && !isAsset) {
        continue;
      }

      const initBal = parseInt(initialBalances[name] || 0, 10);
      const initPt = parseInt(initialPoints[name] || 0, 10);
      const allTime = allTimeMap[name] || { totalIncome: 0, totalExpense: 0, totalUsedPoint: 0 };
      const mTime = monthMap[name] || { monthIncome: 0, monthExpense: 0 };
      
      // 실제 개별 거래 건에 기록된 used_point 의 총합
      const totalUsedPt = allTime.totalUsedPoint || 0;
      // 실거래 포인트 차감의 합과 사용자 지정 초기 포인트 한도 중 큰 값을 유효 포인트 한도로 계산
      const effectivePoint = Math.max(totalUsedPt, initPt);
      
      // 포인트 차감이 설정된 경우의 지출 보정 및 잔액/포인트 계산 (실제 사용 포인트 totalUsedPt 차감 적용)
      const adjustedExpense = Math.max(0, allTime.totalExpense - totalUsedPt);
      const currentBalance = initBal + allTime.totalIncome - adjustedExpense;
      const remainingPoint = effectivePoint > 0 ? Math.max(0, effectivePoint - totalUsedPt) : 0;

      assets.push({
        name,
        isCard,
        initialBalance: initBal,
        currentBalance,
        monthIncome: mTime.monthIncome,
        monthExpense: mTime.monthExpense,
        initialPoint: effectivePoint, // UI에는 실질 한도(effectivePoint)를 노출
        remainingPoint
      });
    }

    res.json({
      totalExpense,
      totalIncome,
      budget,
      categories: categoryRows,
      daily: dailyRows,
      trend: monthlyTrend,
      assets
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 월별 수입/지출 추이 (최근 12개월)
router.get('/analytics/monthly', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const rows = await db.all(`
      SELECT 
        strftime('%Y-%m', datetime) as month,
        SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
      FROM transactions
      WHERE datetime IS NOT NULL AND datetime != ''
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `);
    res.json(rows.reverse()); // 연대순으로 정렬
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 특정 월의 상세 분석 (일별 흐름 및 카테고리별 지출, 이체 제외)
router.get('/analytics/monthly-detail', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: '조회할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;

    // 1. 일자별 수입 및 지출 (이체 제외)
    const dailyRows = await db.all(`
      SELECT 
        strftime('%d', datetime) as day,
        SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
      FROM transactions
      WHERE datetime LIKE ?
      GROUP BY day
      ORDER BY day ASC
    `, [`${targetMonth}%`]);

    // 2. 카테고리별 지출 (이체 제외)
    const categoryRows = await db.all(`
      SELECT 
        category,
        SUM(amount) as total
      FROM transactions
      WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category != '이체/입금'
      GROUP BY category
      ORDER BY total DESC
    `, [`${targetMonth}%`]);

    res.json({
      daily: dailyRows,
      categories: categoryRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 연도별 월별 흐름 및 카테고리 비교
router.get('/analytics/yearly', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year } = req.query;
    if (!year) {
      return res.status(400).json({ error: '조회할 연도(year)를 지정해 주세요.' });
    }

    const prevYear = String(parseInt(year, 10) - 1);

    // 1. 월별 수입 및 지출 (이체 제외)
    const monthlyRows = await db.all(`
      SELECT 
        strftime('%m', datetime) as month,
        SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense
      FROM transactions
      WHERE datetime LIKE ?
      GROUP BY month
      ORDER BY month ASC
    `, [`${year}%`]);

    // 2. 카테고리별 지출 비교 (올해 vs 작년, 이체 제외)
    const categoryCompare = await db.all(`
      SELECT 
        c.name as category,
        COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_year_total,
        COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_year_total
      FROM categories c
      LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
      WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
      GROUP BY c.name
      ORDER BY current_year_total DESC
    `, [year, prevYear, `${year}%`, `${prevYear}%`]);

    res.json({
      monthly: monthlyRows,
      categories: categoryCompare
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카테고리별 전년 대비 또는 전월 대비 소비 비교 API
router.get('/analytics/compare', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { mode, year, month } = req.query; // mode: 'yoy' 또는 'mom'
    
    if (!year) {
      return res.status(400).json({ error: '조회할 연도(year)를 지정해 주세요.' });
    }

    if (mode === 'mom') {
      if (!month) {
        return res.status(400).json({ error: '전월 대비 조회를 위해 월(month)을 지정해 주세요.' });
      }
      
      const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
      
      // 이전 월 계산
      const curDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      curDate.setMonth(curDate.getMonth() - 1);
      const prevMonth = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, '0')}`;

      const categoryCompare = await db.all(`
        SELECT 
          c.name as category,
          COALESCE(SUM(CASE WHEN strftime('%Y-%m', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_total,
          COALESCE(SUM(CASE WHEN strftime('%Y-%m', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_total
        FROM categories c
        LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
        WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
        GROUP BY c.name
        ORDER BY current_total DESC
      `, [currentMonth, prevMonth, `${currentMonth}%`, `${prevMonth}%`]);

      res.json({
        compare: categoryCompare,
        current_label: `${parseInt(month, 10)}월`,
        prev_label: `${curDate.getMonth() + 1}월`
      });
    } else {
      // 기본값: 전년 대비 (yoy)
      const prevYear = String(parseInt(year, 10) - 1);
      const categoryCompare = await db.all(`
        SELECT 
          c.name as category,
          COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as current_total,
          COALESCE(SUM(CASE WHEN strftime('%Y', t.datetime) = ? THEN t.amount ELSE 0 END), 0) as prev_total
        FROM categories c
        LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE'
        WHERE c.name != '이체/송금' AND c.name != '이체/입금' AND (t.datetime LIKE ? OR t.datetime LIKE ? OR t.datetime IS NULL)
        GROUP BY c.name
        ORDER BY current_total DESC
      `, [year, prevYear, `${year}%`, `${prevYear}%`]);

      res.json({
        compare: categoryCompare,
        current_label: '올해 누적',
        prev_label: '전년도 누적'
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 월별 고정지출 분석 API (구독, 보험, 공과금, 주거/통신 등)
// 요약: 선택한 연도/월 기준 고정비 카테고리에 속하는 지출을 분석하고 최근 6개월 월별 추이 및 거래내역 목록을 반환합니다.
// 의존성: database.js (getDB)와 연동됩니다.
router.get('/analytics/fixed', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: '조회할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
    const fixedCategories = ['구독', '보험', '공과금', '주거/통신'];
    const placeholders = fixedCategories.map(() => '?').join(',');

    // 1. 해당 월 총 지출액 (비율 계산용, 이체/송금 제외)
    const totalSpentRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
      [`${targetMonth}%`]
    );
    const totalSpent = totalSpentRow.total || 0;

    // 2. 해당 월 총 고정지출액 합계
    const fixedTotalRow = await db.get(
      `SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders})`,
      [`${targetMonth}%`, ...fixedCategories]
    );
    const fixedTotal = fixedTotalRow.total || 0;

    // 3. 카테고리별 고정지출액 합계 (도넛 차트용)
    const categoryRows = await db.all(
      `SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders}) GROUP BY category ORDER BY total DESC`,
      [`${targetMonth}%`, ...fixedCategories]
    );

    // 4. 고정지출 상세 내역 목록 (테이블용, 최근순)
    const transactionRows = await db.all(
      `SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders}) ORDER BY datetime DESC`,
      [`${targetMonth}%`, ...fixedCategories]
    );

    // 5. 최근 6개월간 월별 고정지출 추이 (바/라인 차트용)
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      d.setMonth(d.getMonth() - i);
      const targetM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const trendRow = await db.get(
        `SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders})`,
        [`${targetM}%`, ...fixedCategories]
      );
      monthlyTrend.push({
        month: targetM,
        total: trendRow.total || 0
      });
    }

    res.json({
      totalSpent,
      fixedTotal,
      categories: categoryRows,
      transactions: transactionRows,
      trend: monthlyTrend
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
