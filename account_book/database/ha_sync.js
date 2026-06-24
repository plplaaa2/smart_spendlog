const crypto = require('crypto');
const { getDB, getActiveUsers } = require('./connection');
const { createInAppNotification } = require('./notifications');

const notifiedStates = {}; // (username_YYYY-MM_type -> boolean)

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`요청 타임아웃 (${timeoutMs}ms 초과)`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

function getSafeSuffix(username) {
  if (!username || username === 'admin') return '';
  const isSafe = /^[a-zA-Z0-9_]+$/.test(username);
  if (isSafe) {
    return `_${username.toLowerCase()}`;
  }
  return `_${crypto.createHash('sha1').update(String(username), 'utf8').digest('hex').slice(0, 12)}`;
}

async function updateHASensors(targetUser) {
  const db = await getDB(targetUser);
  if (!db) return;

  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const budgetRow = await db.get("SELECT value FROM settings WHERE key = 'monthly_budget'");
    const budget = budgetRow ? parseInt(budgetRow.value, 10) || 0 : 0;

    const initialBalanceRow = await db.get("SELECT value FROM settings WHERE key = 'initial_balance'");
    const initialBalance = initialBalanceRow ? parseInt(initialBalanceRow.value, 10) || 0 : 0;

    const initialBalancesRow = await db.get("SELECT value FROM settings WHERE key = 'initial_balances'");
    let initialBalancesSum = 0;
    if (initialBalancesRow && initialBalancesRow.value) {
      try {
        const parsed = JSON.parse(initialBalancesRow.value);
        if (parsed) {
          Object.values(parsed).forEach(v => {
            initialBalancesSum += parseInt(v, 10) || 0;
          });
        }
      } catch (e) {}
    }

    const effectiveInitialBalance = Math.max(initialBalance, initialBalancesSum);

    const summaryRow = await db.get(
      "SELECT " +
      "SUM(CASE WHEN type = 'INCOME' AND category != '이체/입금' THEN amount ELSE 0 END) as income, " +
      "SUM(CASE WHEN type = 'EXPENSE' AND category != '이체/송금' THEN amount ELSE 0 END) as expense " +
      "FROM transactions WHERE datetime LIKE ?",
      [`${currentMonth}%`]
    );

    const income = summaryRow ? summaryRow.income || 0 : 0;
    const expense = summaryRow ? summaryRow.expense || 0 : 0;
    
    const remainingBudget = Math.max(0, budget - expense);
    const netProfit = income - expense;
    const savings = effectiveInitialBalance + income - expense;

    const suffix = getSafeSuffix(targetUser);
    const nameTag = targetUser === 'admin' ? '' : ` (${targetUser})`;

    if (budget > 0) {
      const overLimitKey = `${targetUser}_${currentMonth}_over_limit`;
      const nearLimitKey = `${targetUser}_${currentMonth}_near_limit`;

      if (expense > budget) {
        if (!notifiedStates[overLimitKey]) {
          notifiedStates[overLimitKey] = true;
          const overAmount = expense - budget;
          await sendHANotification(
            db,
            `🚨 [Smart Spendlog] 이번 달 예산 초과 경고${nameTag}`,
            `이번 달 지출액이 설정하신 예산을 초과했습니다!\n\n` +
            `- 현재 지출: **${expense.toLocaleString()}원**\n` +
            `- 설정 예산: **${budget.toLocaleString()}원**\n` +
            `- 초과 금액: **${overAmount.toLocaleString()}원**`
          );
          await createInAppNotification(
            targetUser,
            'BUDGET_OVER',
            `이번 달 예산 초과 경고`,
            `이번 달 지출액이 설정하신 예산을 초과했습니다!\n- 현재 지출: ${expense.toLocaleString()}원\n- 설정 예산: ${budget.toLocaleString()}원\n- 초과 금액: ${overAmount.toLocaleString()}원`
          );
        }
      } else {
        if (notifiedStates[overLimitKey]) {
          delete notifiedStates[overLimitKey];
        }

        if (expense >= budget * 0.9) {
          if (!notifiedStates[nearLimitKey]) {
            notifiedStates[nearLimitKey] = true;
            await sendHANotification(
              db,
              `⚠️ [Smart Spendlog] 예산 90% 소진 안내${nameTag}`,
              `이번 달 설정하신 예산의 90% 이상을 소진했습니다. 계획적인 소비를 권장합니다.\n\n` +
              `- 현재 지출: **${expense.toLocaleString()}원**\n` +
              `- 남은 예산: **${(budget - expense).toLocaleString()}원**`
            );
            await createInAppNotification(
              targetUser,
              'BUDGET_NEAR',
              `예산 90% 소진 안내`,
              `이번 달 설정하신 예산의 90% 이상을 소진했습니다. 계획적인 소비를 권장합니다.\n- 현재 지출: ${expense.toLocaleString()}원\n- 남은 예산: ${(budget - expense).toLocaleString()}원`
            );
          }
        } else {
          if (notifiedStates[nearLimitKey]) {
            delete notifiedStates[nearLimitKey];
          }
        }
      }
    }

    if (income > 0 && expense > 0) {
      const deficitKey = `${targetUser}_${currentMonth}_net_profit_deficit`;
      if (income < expense) {
        if (!notifiedStates[deficitKey]) {
          notifiedStates[deficitKey] = true;
          const deficitAmount = expense - income;
          await sendHANotification(
            db,
            `📉 [Smart Spendlog] 이번 달 재정 적자 전환 경고${nameTag}`,
            `이번 달 지출이 수입을 초과하여 적자 상태로 전환되었습니다!\n\n` +
            `- 현재 수입: **${income.toLocaleString()}원**\n` +
            `- 현재 지출: **${expense.toLocaleString()}원**\n` +
            `- 적자 금액: **${deficitAmount.toLocaleString()}원**`
          );
          await createInAppNotification(
            targetUser,
            'DEFICIT',
            `이번 달 재정 적자 전환 경고`,
            `이번 달 지출이 수입을 초과하여 적자 상태로 전환되었습니다!\n- 현재 수입: ${income.toLocaleString()}원\n- 현재 지출: ${expense.toLocaleString()}원\n- 적자 금액: ${deficitAmount.toLocaleString()}원`
          );
        }
      } else {
        if (notifiedStates[deficitKey]) {
          delete notifiedStates[deficitKey];
        }
      }
    }

    const goalsRow = await db.get("SELECT value FROM settings WHERE key = 'card_performance_goals'");
    if (goalsRow && goalsRow.value) {
      let cardGoals = {};
      try {
        cardGoals = JSON.parse(goalsRow.value);
      } catch (e) {}

      if (Object.keys(cardGoals).length > 0) {
        const perfDaysRow = await db.get("SELECT value FROM settings WHERE key = 'card_performance_days'");
        let cardPerformanceDays = {};
        if (perfDaysRow && perfDaysRow.value) {
          try {
            cardPerformanceDays = JSON.parse(perfDaysRow.value);
          } catch (e) {}
        }

        const [yearStr, monthStr] = currentMonth.split('-');
        const yearVal = parseInt(yearStr, 10);
        const monthVal = parseInt(monthStr, 10);

        for (const cardName of Object.keys(cardGoals)) {
          const goal = parseInt(cardGoals[cardName], 10) || 0;
          if (goal <= 0) continue;

          const startDay = parseInt(cardPerformanceDays[cardName] || 1, 10);
          let currentExpense = 0;

          if (startDay > 1) {
            const startYear = monthVal === 1 ? yearVal - 1 : yearVal;
            const startMonth = monthVal === 1 ? 12 : monthVal - 1;
            const startStr = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')} 00:00:00`;
            const endStr = `${yearVal}-${String(monthVal).padStart(2, '0')}-${String(startDay - 1).padStart(2, '0')} 23:59:59`;

            // 요약: Home Assistant 연동 및 실적 달성 체크 시 포인트 및 지원금 사용액(used_point) 합산 (커스텀 기간)
            // 의존성: routes/analytics.js, android_spendlog/.../AnalyticsApiHandler.kt
            const customRow = await db.get(
              "SELECT SUM(amount + COALESCE(used_point, 0)) as expense FROM transactions " +
              "WHERE pay_method = ? AND type = 'EXPENSE' AND category != '이체/송금' " +
              "AND datetime >= ? AND datetime <= ?",
              [cardName, startStr, endStr]
            );
            currentExpense = customRow ? customRow.expense || 0 : 0;
          } else {
            // 요약: Home Assistant 연동 및 실적 달성 체크 시 포인트 및 지원금 사용액(used_point) 합산 (기본 달력)
            // 의존성: routes/analytics.js, android_spendlog/.../AnalyticsApiHandler.kt
            const calendarRow = await db.get(
              "SELECT SUM(amount + COALESCE(used_point, 0)) as expense FROM transactions " +
              "WHERE pay_method = ? AND type = 'EXPENSE' AND category != '이체/송금' " +
              "AND datetime LIKE ?",
              [cardName, `${currentMonth}%`]
            );
            currentExpense = calendarRow ? calendarRow.expense || 0 : 0;
          }

          const perfKey = `${targetUser}_${currentMonth}_perf_achieved_${cardName}`;
          if (currentExpense >= goal) {
            if (!notifiedStates[perfKey]) {
              notifiedStates[perfKey] = true;
              await sendHANotification(
                db,
                `🎉 [Smart Spendlog] ${cardName} 실적 달성 완료${nameTag}`,
                `축하합니다! 이번 달 **${cardName}**의 목표 실적을 달성했습니다.\n\n` +
                `- 누적 실적: **${currentExpense.toLocaleString()}원**\n` +
                `- 목표 실적: **${goal.toLocaleString()}원**`
              );
              await createInAppNotification(
                targetUser,
                'CARD_PERF',
                `${cardName} 실적 달성 완료`,
                `축하합니다! 이번 달 **${cardName}**의 목표 실적을 달성했습니다.\n- 누적 실적: ${currentExpense.toLocaleString()}원\n- 목표 실적: ${goal.toLocaleString()}원`
              );
            }
          } else {
            if (notifiedStates[perfKey]) {
              delete notifiedStates[perfKey];
            }
          }
        }
      }
    }

    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) {
      return;
    }

    const sensors = [
      {
        entity_id: `sensor.account_book_monthly_income${suffix}`,
        state: income,
        friendly_name: `가계부 이번 달 수입${nameTag}`,
        icon: 'mdi:cash-plus'
      },
      {
        entity_id: `sensor.account_book_monthly_expense${suffix}`,
        state: expense,
        friendly_name: `가계부 이번 달 지출${nameTag}`,
        icon: 'mdi:cash-minus'
      },
      {
        entity_id: `sensor.account_book_remaining_budget${suffix}`,
        state: remainingBudget,
        friendly_name: `가계부 남은 예산${nameTag}`,
        icon: 'mdi:piggy-bank'
      },
      {
        entity_id: `sensor.account_book_net_profit${suffix}`,
        state: netProfit,
        friendly_name: `가계부 순수 이익${nameTag}`,
        icon: 'mdi:scale-balance'
      },
      {
        entity_id: `sensor.account_book_savings${suffix}`,
        state: savings,
        friendly_name: `가계부 저축액${nameTag}`,
        icon: 'mdi:bank-transfer-in'
      }
    ];

    for (const sensor of sensors) {
      const url = `http://supervisor/core/api/states/${sensor.entity_id}`;
      const payload = {
        state: String(sensor.state),
        attributes: {
          friendly_name: sensor.friendly_name,
          unit_of_measurement: '원',
          icon: sensor.icon,
          last_updated_at: new Date().toISOString()
        }
      };

      try {
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          console.error(`[HA WS] 센서 ${sensor.entity_id} 업데이트 실패: HTTP ${response.status}`);
        }
      } catch (err) {
        console.error(`[HA WS] 센서 ${sensor.entity_id} 전송 에러:`, err.message);
      }
    }
    console.log(`[HA WS][${targetUser}] 이번 달 가계부 지표 센서 동기화 완료 (수입: ${income}원, 지출: ${expense}원, 남은예산: ${remainingBudget}원)`);
  } catch (err) {
    console.error(`[HA WS][${targetUser}] 가계부 지표 집계 및 센서 전송 중 오류:`, err);
  }
}

async function cleanupOrphanedHASensors(activeUsers = []) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return;

  try {
    const activeSuffixes = activeUsers.map(u => getSafeSuffix(u));
    const url = 'http://supervisor/core/api/states';
    const response = await fetchWithTimeout(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`[HA WS][Cleanup] HA 상태 조회 실패: HTTP ${response.status}`);
      return;
    }

    const states = await response.json();
    if (!Array.isArray(states)) return;

    const abSensors = states.filter(s => s.entity_id.startsWith('sensor.account_book_'));
    const baseNames = ['monthly_income', 'monthly_expense', 'remaining_budget', 'net_profit', 'savings'];

    for (const sensor of abSensors) {
      const entityId = sensor.entity_id;
      const subName = entityId.replace('sensor.account_book_', '');
      
      let matchedBase = null;
      for (const base of baseNames) {
        if (subName.startsWith(base)) {
          matchedBase = base;
          break;
        }
      }

      if (matchedBase) {
        const suffix = subName.replace(matchedBase, '');
        if (!activeSuffixes.includes(suffix)) {
          console.log(`[HA WS][Cleanup] 고아 센서 감지: ${entityId} (Suffix: '${suffix}'). 삭제를 시도합니다.`);
          const deleteUrl = `http://supervisor/core/api/states/${entityId}`;
          try {
            const delRes = await fetchWithTimeout(deleteUrl, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });
            if (delRes.ok) {
              console.log(`[HA WS][Cleanup] 고아 센서 삭제 성공: ${entityId}`);
            } else {
              console.error(`[HA WS][Cleanup] 고아 센서 삭제 실패: ${entityId} (HTTP ${delRes.status})`);
            }
          } catch (delErr) {
            console.error(`[HA WS][Cleanup] 고아 센서 ${entityId} 삭제 요청 중 에러:`, delErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[HA WS][Cleanup] 고아 센서 정리 중 오류 발생:', err);
  }
}

async function sendHANotification(db, title, message) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return;

  // 1. 기존 영구 알림(Persistent Notification) 생성 유지 (웹 UI 알림센터 연동)
  const persistentUrl = 'http://supervisor/core/api/services/persistent_notification/create';
  try {
    await fetchWithTimeout(persistentUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, message })
    });
  } catch (err) {
    console.error('[HA WS][Notification] 웹 영구 알림 전송 에러:', err.message);
  }

  // 2. 스마트폰 Companion 앱 모바일 푸시 알림 전송 시도
  let pushed = false;
  if (db) {
    try {
      const row = await db.get("SELECT value FROM settings WHERE key = 'ws_sensor_entity'");
      const wsSensorEntity = row ? row.value : null;

      if (wsSensorEntity && wsSensorEntity.startsWith('sensor.')) {
        const match = wsSensorEntity.match(/^sensor\.(.+)_last_notification$/);
        if (match && match[1]) {
          const deviceName = match[1];
          const mobileAppUrl = `http://supervisor/core/api/services/notify/mobile_app_${deviceName}`;
          const response = await fetchWithTimeout(mobileAppUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, message })
          });
          if (response.ok) {
            pushed = true;
            console.log(`[HA WS][Notification] 모바일 앱 푸시 알림 전송 성공: ${deviceName}`);
          } else {
            console.warn(`[HA WS][Notification] 모바일 앱 푸시 알림 전송 실패: HTTP ${response.status}`);
          }
        }
      }
    } catch (dbErr) {
      console.error('[HA WS][Notification] 모바일 푸시 대상 조회 중 에러:', dbErr.message);
    }
  }

  // 3. 폴백: 장치명 파싱에 실패했거나 모바일 전송 실패 시 공통 notify 서비스 호출
  if (!pushed) {
    const notifyUrl = 'http://supervisor/core/api/services/notify/notify';
    try {
      const response = await fetchWithTimeout(notifyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title, message })
      });
      if (response.ok) {
        console.log('[HA WS][Notification] 공통 notify 서비스 푸시 전송 성공');
      }
    } catch (err) {
      console.error('[HA WS][Notification] 공통 notify 서비스 전송 중 에러:', err.message);
    }
  }
}

module.exports = {
  notifiedStates,
  getSafeSuffix,
  updateHASensors,
  cleanupOrphanedHASensors,
  sendHANotification
};
