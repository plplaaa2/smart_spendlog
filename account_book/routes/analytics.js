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
const { generateConsumptionReportWithAI } = require('../parser');
const cryptoHelper = require('../crypto_helper');

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

    // 해당 월 입출금 (1일 ~ 말일 기본 달력 기준)
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

    // 카드 실적 기준일 설정 읽기
    const perfDaysRow = await db.get("SELECT value FROM settings WHERE key = 'card_performance_days'");
    let cardPerformanceDays = {};
    if (perfDaysRow && perfDaysRow.value) {
      try {
        cardPerformanceDays = JSON.parse(perfDaysRow.value);
      } catch (e) {
        cardPerformanceDays = {};
      }
    }

    // 카드 실적 기준일이 지정된 경우 개별 집계 보정
    const [yearStr, monthStr] = month.split('-');
    const yearVal = parseInt(yearStr, 10);
    const monthVal = parseInt(monthStr, 10);

    for (const pm of payMethods) {
      const name = pm.name;
      const startDay = parseInt(cardPerformanceDays[name] || 1, 10);
      if (startDay > 1) {
        // 커스텀 기간 계산 (예: 시작일이 15일이면 4월 15일 00:00:00 ~ 5월 14일 23:59:59)
        const startYear = monthVal === 1 ? yearVal - 1 : yearVal;
        const startMonth = monthVal === 1 ? 12 : monthVal - 1;
        const startStr = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')} 00:00:00`;
        const endStr = `${yearVal}-${String(monthVal).padStart(2, '0')}-${String(startDay - 1).padStart(2, '0')} 23:59:59`;

        const customRow = await db.get(
          "SELECT SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END) as month_income, " +
          "SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END) as month_expense " +
          "FROM transactions WHERE pay_method = ? AND datetime >= ? AND datetime <= ?",
          [name, startStr, endStr]
        );

        monthMap[name] = {
          monthIncome: customRow.month_income || 0,
          monthExpense: customRow.month_expense || 0
        };
      }
    }

    const assets = [];
    for (const m of payMethods) {
      const name = m.name;
      
      // 제외할 일반 명칭 및 범주명
      if (name === '계좌이체' || name === '신용카드' || name === '체크카드') {
        continue;
      }
      
      const isCard = name.includes('카드') || name.includes('페이') || name.includes('머니');
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

    const isYearly = (month === 'all');
    const targetPattern = isYearly ? `${year}%` : `${year}-${String(month).padStart(2, '0')}%`;
    const fixedCategories = ['구독', '보험', '수도광열비', '주거', '통신비', '대출상환']; // 대출상환 고정비 분석 추가. 의존성: default_rules.json, database.js의 카테고리 설정과 일치해야 합니다.
    const placeholders = fixedCategories.map(() => '?').join(',');

    // 1. 해당 기간 총 지출액 (비율 계산용, 이체/송금 제외)
    const totalSpentRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
      [targetPattern]
    );
    const totalSpent = totalSpentRow.total || 0;

    // 2. 해당 기간 총 고정지출액 합계
    const fixedTotalRow = await db.get(
      `SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders})`,
      [targetPattern, ...fixedCategories]
    );
    const fixedTotal = fixedTotalRow.total || 0;

    // 3. 카테고리별 고정지출액 합계 (도넛 차트용)
    const categoryRows = await db.all(
      `SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders}) GROUP BY category ORDER BY total DESC`,
      [targetPattern, ...fixedCategories]
    );

    // 4. 고정지출 상세 내역 목록 (테이블용, 최근순)
    const transactionRows = await db.all(
      `SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders}) ORDER BY datetime DESC`,
      [targetPattern, ...fixedCategories]
    );

    // 5. 월별 고정지출 추이 (바/라인 차트용)
    const monthlyTrend = [];
    if (isYearly) {
      const trendRows = await db.all(
        `SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category IN (${placeholders}) GROUP BY month ORDER BY month ASC`,
        [targetPattern, ...fixedCategories]
      );
      const trendMap = {};
      trendRows.forEach(r => {
        trendMap[r.month] = r.total;
      });
      for (let m = 1; m <= 12; m++) {
        const monthKey = `${year}-${String(m).padStart(2, '0')}`;
        monthlyTrend.push({
          month: monthKey,
          total: trendMap[monthKey] || 0
        });
      }
    } else {
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

// 월별 일반지출 분석 API (구독, 보험, 공과금, 주거/통신, 대출상환 제외한 나머지 지출)
// 요약: 선택한 연도/월 기준 고정지출 카테고리를 제외한 일반 지출을 분석하고 최근 6개월 월별 추이 및 거래내역 목록을 반환합니다.
// 의존성: database.js (getDB)와 연동되며 public/analytics.js of loadGeneralAnalytics와 연계됩니다.
router.get('/analytics/general', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: '조회할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const isYearly = (month === 'all');
    const targetPattern = isYearly ? `${year}%` : `${year}-${String(month).padStart(2, '0')}%`;
    const fixedCategories = ['구독', '보험', '수도광열비', '주거', '통신비', '대출상환'];
    const placeholders = fixedCategories.map(() => '?').join(',');

    // 1. 해당 기간 총 지출액 (비율 계산용, 이체/송금 제외)
    const totalSpentRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
      [targetPattern]
    );
    const totalSpent = totalSpentRow.total || 0;

    // 2. 해당 기간 총 일반지출액 합계 (고정지출 제외, 이체/송금 제외)
    const generalTotalRow = await db.get(
      `SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN (${placeholders})`,
      [targetPattern, ...fixedCategories]
    );
    const generalTotal = generalTotalRow.total || 0;

    // 3. 카테고리별 일반지출액 합계 (도넛 차트용)
    const categoryRows = await db.all(
      `SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN (${placeholders}) GROUP BY category ORDER BY total DESC`,
      [targetPattern, ...fixedCategories]
    );

    // 4. 일반지출 상세 내역 목록 (테이블용, 최근순)
    const transactionRows = await db.all(
      `SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN (${placeholders}) ORDER BY datetime DESC`,
      [targetPattern, ...fixedCategories]
    );

    // 5. 월별 일반지출 추이 (바/라인 차트용)
    const monthlyTrend = [];
    if (isYearly) {
      const trendRows = await db.all(
        `SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN (${placeholders}) GROUP BY month ORDER BY month ASC`,
        [targetPattern, ...fixedCategories]
      );
      const trendMap = {};
      trendRows.forEach(r => {
        trendMap[r.month] = r.total;
      });
      for (let m = 1; m <= 12; m++) {
        const monthKey = `${year}-${String(m).padStart(2, '0')}`;
        monthlyTrend.push({
          month: monthKey,
          total: trendMap[monthKey] || 0
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
        d.setMonth(d.getMonth() - i);
        const targetM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const trendRow = await db.get(
          `SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' AND category NOT IN (${placeholders})`,
          [`${targetM}%`, ...fixedCategories]
        );
        monthlyTrend.push({
          month: targetM,
          total: trendRow.total || 0
        });
      }
    }

    res.json({
      totalSpent,
      generalTotal,
      categories: categoryRows,
      transactions: transactionRows,
      trend: monthlyTrend
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 월별/연간 소득 분석 API (이체/입금 제외한 수입 및 저축비율 계산용 지출액)
// 요약: 선택한 연도/월 기준 수입(INCOME)을 분석하고 최근 6개월 월별 추이 및 거래내역 목록을 반환합니다.
// 의존성: database.js (getDB)와 연동되며 public/analytics.js의 loadIncomeAnalytics와 연계됩니다.
router.get('/analytics/income', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: '조회할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const isYearly = (month === 'all');
    const targetPattern = isYearly ? `${year}%` : `${year}-${String(month).padStart(2, '0')}%`;

    // 1. 해당 기간 총 수입액 합계 (이체/입금 제외)
    const incomeTotalRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
      [targetPattern]
    );
    const incomeTotal = incomeTotalRow.total || 0;

    // 2. 해당 기간 총 지출액 합계 (저축 비율 계산용, 이체/송금 제외)
    const totalSpentRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
      [targetPattern]
    );
    const totalSpent = totalSpentRow.total || 0;

    // 3. 카테고리별 수입액 합계 (도넛 차트용)
    const categoryRows = await db.all(
      "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' GROUP BY category ORDER BY total DESC",
      [targetPattern]
    );

    // 4. 수입 상세 내역 목록 (테이블용, 최근순)
    const transactionRows = await db.all(
      "SELECT id, datetime, merchant, category, pay_method, amount, memo FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' ORDER BY datetime DESC",
      [targetPattern]
    );

    // 5. 월별 수입 추이 (바/라인 차트용)
    const monthlyTrend = [];
    if (isYearly) {
      const trendRows = await db.all(
        "SELECT strftime('%Y-%m', datetime) as month, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금' GROUP BY month ORDER BY month ASC",
        [targetPattern]
      );
      const trendMap = {};
      trendRows.forEach(r => {
        trendMap[r.month] = r.total;
      });
      for (let m = 1; m <= 12; m++) {
        const monthKey = `${year}-${String(m).padStart(2, '0')}`;
        monthlyTrend.push({
          month: monthKey,
          total: trendMap[monthKey] || 0
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
        d.setMonth(d.getMonth() - i);
        const targetM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const trendRow = await db.get(
          "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
          [`${targetM}%`]
        );
        monthlyTrend.push({
          month: targetM,
          total: trendRow.total || 0
        });
      }
    }

    res.json({
      incomeTotal,
      totalSpent,
      categories: categoryRows,
      transactions: transactionRows,
      trend: monthlyTrend
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// AI 소비 리포트 관련 API
// ==========================================

// 1. AI 소비 리포트 조회 API
// 요약: 특정 사용자명, 연도, 월 정보에 기반해 이미 데이터베이스에 구축된 AI 리포트가 있으면 반환합니다.
// 의존성: database.js의 getDB를 활용해 유저 DB에 쿼리를 전송합니다.
router.get('/analytics/ai-report', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: '조회할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const reportType = (month === 'all') ? 'YEARLY' : 'MONTHLY';
    const targetMonth = (month === 'all') ? 0 : parseInt(month, 10);
    const targetYear = parseInt(year, 10);

    const report = await db.get(
      'SELECT summary, content, created_at FROM ai_reports WHERE report_type = ? AND target_year = ? AND target_month = ?',
      [reportType, targetYear, targetMonth]
    );

    if (report) {
      res.json({ success: true, report });
    } else {
      res.json({ success: false, message: '생성된 AI 소비 리포트가 없습니다.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. AI 소비 리포트 생성/재생성 API
// 요약: 가계부 지출/수입 데이터와 예산 한도 등의 데이터를 수집하여 AI 프롬프트를 조립하고, 설정된 AI 모델(Gemini/OpenAI 등)을 연동해 가계 리포트를 작성 후 저장/반환합니다.
// 의존성: parser.js의 generateConsumptionReportWithAI 및 crypto_helper.js 복호화를 연계합니다.
router.post('/analytics/ai-report/generate', async (req, res) => {
  try {
    const db = await getDB(req.username);
    const { year, month } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: '생성할 연도(year)와 월(month)을 지정해 주세요.' });
    }

    const isYearly = (month === 'all');
    const targetYear = parseInt(year, 10);
    const targetMonth = isYearly ? 0 : parseInt(month, 10);
    const reportType = isYearly ? 'YEARLY' : 'MONTHLY';

    // 1. AI 설정 조회 및 검증
    const settingsList = await db.all(
      "SELECT key, value FROM settings WHERE key IN ('ai_parsing_enabled', 'ai_provider', 'ai_api_key', 'ai_local_ip', 'ai_local_model')"
    );
    const settings = {};
    settingsList.forEach(row => {
      settings[row.key] = row.value;
    });

    if (settings.ai_parsing_enabled !== 'true') {
      return res.status(400).json({ error: 'AI 설정이 비활성화 상태입니다. 설정 탭의 AI 설정에서 먼저 활성화해 주세요.' });
    }

    const provider = settings.ai_provider || 'gemini';
    let apiKey = settings.ai_api_key;
    if (apiKey && (provider === 'gemini' || provider === 'openai')) {
      try {
        apiKey = cryptoHelper.decrypt(apiKey);
      } catch (decErr) {
        console.error('[AI 리포트] API Key 복호화 실패:', decErr.message);
      }
    }

    const aiConfig = {
      provider,
      apiKey,
      localIp: settings.ai_local_ip,
      localModel: settings.ai_local_model
    };

    // 2. 가계부 데이터 수집
    let dataText = '';
    const targetPattern = isYearly ? `${year}%` : `${year}-${String(month).padStart(2, '0')}%`;

    // 총 수입액 (이체/입금 제외)
    const incomeRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'INCOME' AND category != '이체/입금'",
      [targetPattern]
    );
    const totalIncome = incomeRow.total || 0;

    // 총 지출액 (이체/송금 제외)
    const expenseRow = await db.get(
      "SELECT SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'",
      [targetPattern]
    );
    const totalExpense = expenseRow.total || 0;

    // 카테고리별 지출 내역
    const categories = await db.all(
      "SELECT category, SUM(amount) as total FROM transactions WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금' GROUP BY category ORDER BY total DESC",
      [targetPattern]
    );

    // 예산 설정값
    const budgetKey = isYearly ? `budget_${year}` : `budget_${year}_${String(month).padStart(2, '0')}`;
    const budgetRow = await db.get("SELECT value FROM settings WHERE key = ?", [budgetKey]);
    const budget = budgetRow ? parseInt(budgetRow.value, 10) : 0;

    // 월별/일자별 추이 데이터 집계 (프롬프트 간소화용 요약)
    let trendText = '';
    if (isYearly) {
      // 월별 수입 및 지출
      const monthlyData = await db.all(`
        SELECT 
          strftime('%m', datetime) as mm,
          SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as inc,
          SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as exp
        FROM transactions 
        WHERE datetime LIKE ? 
        GROUP BY mm 
        ORDER BY mm ASC
      `, [targetPattern]);

      trendText = monthlyData.map(m => `  - ${m.mm}월: 수입 ${m.inc.toLocaleString()}원, 지출 ${m.exp.toLocaleString()}원`).join('\n');
      
      dataText = `[${year}년 연간 가계 통계 데이터]
- 총 수입: ${totalIncome.toLocaleString()}원 (이체/입금 제외)
- 총 지출: ${totalExpense.toLocaleString()}원 (이체/송금 제외)
- 순수익 (수입-지출): ${(totalIncome - totalExpense).toLocaleString()}원
- 연간 총 예산: ${budget > 0 ? budget.toLocaleString() + '원' : '설정되지 않음'}
- 카테고리별 지출 비중:
${categories.map(c => `  - ${c.category}: ${c.total.toLocaleString()}원 (${((c.total / (totalExpense || 1)) * 100).toFixed(1)}%)`).join('\n')}
- 월별 수입 및 지출 흐름:
${trendText || '  (기록된 월별 데이터 없음)'}`;

    } else {
      // 일별 상위 지출 요약
      const dailyExpenses = await db.all(`
        SELECT 
          strftime('%d', datetime) as dd,
          SUM(amount) as total
        FROM transactions 
        WHERE datetime LIKE ? AND type = 'EXPENSE' AND category != '이체/송금'
        GROUP BY dd 
        ORDER BY total DESC 
        LIMIT 5
      `, [targetPattern]);

      trendText = dailyExpenses.map(d => `  - ${d.dd}일 지출 합계: ${d.total.toLocaleString()}원`).join('\n');

      dataText = `[${year}년 ${month}월 가계 통계 데이터]
- 총 수입: ${totalIncome.toLocaleString()}원 (이체/입금 제외)
- 총 지출: ${totalExpense.toLocaleString()}원 (이체/송금 제외)
- 순수익 (수입-지출): ${(totalIncome - totalExpense).toLocaleString()}원
- 이번 달 설정 예산: ${budget > 0 ? budget.toLocaleString() + '원' : '설정되지 않음'}
- 예산 소진율: ${budget > 0 ? ((totalExpense / budget) * 100).toFixed(1) + '%' : 'N/A'}
- 카테고리별 지출 비중:
${categories.map(c => `  - ${c.category}: ${c.total.toLocaleString()}원 (${((c.total / (totalExpense || 1)) * 100).toFixed(1)}%)`).join('\n')}
- 일자별 주요 지출 일(상위 5일):
${trendText || '  (기록된 지출 없음)'}`;
    }

    // 3. AI 소비 리포트 작성 호출
    const reportResult = await generateConsumptionReportWithAI(dataText, aiConfig);

    if (!reportResult) {
      return res.status(500).json({ error: 'AI 소비 리포트를 생성하는 도중 오류가 발생했습니다. AI 설정 정보를 확인해주세요.' });
    }

    // 4. DB에 저장
    const now = Date.now();
    await db.run(
      `INSERT OR REPLACE INTO ai_reports (report_type, target_year, target_month, summary, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reportType, targetYear, targetMonth, reportResult.summary, reportResult.content, now]
    );

    res.json({
      success: true,
      report: {
        summary: reportResult.summary,
        content: reportResult.content,
        created_at: now
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
