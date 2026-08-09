// Atomically replace a transaction during notification retry processing.
// Related file: routes/rules.js; related tables: transactions, notification_logs.
async function replaceRetryTransaction(db, { rawText, transaction, parsedStatus, matchedRuleId, logId }) {
  await db.run('BEGIN TRANSACTION');
  try {
    await db.run('DELETE FROM transactions WHERE raw_text = ?', [rawText]);
    await db.run(
      'INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transaction.type || 'EXPENSE', transaction.amount, transaction.merchant, transaction.category,
        transaction.payMethod, transaction.datetime, transaction.memo || '', rawText, transaction.usedPoint || 0]
    );
    await db.run('UPDATE notification_logs SET parsed_status = ?, matched_rule_id = ? WHERE id = ?',
      [parsedStatus, matchedRuleId, logId]);
    await db.run('COMMIT');
  } catch (error) {
    try {
      await db.run('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

module.exports = { replaceRetryTransaction };
