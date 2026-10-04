// Atomically replace a transaction during notification retry processing.
// Related file: routes/rules.js; related tables: transactions, notification_logs.
async function replaceRetryTransaction(db, { rawText, transaction, parsedStatus, matchedRuleId, logId }) {
  await db.run('BEGIN TRANSACTION');
  try {
    await db.run('DELETE FROM transactions WHERE raw_text = ?', [rawText]);
    // Preserve validated payment types while supporting callers of the older helper contract.
    // Related: routes/rules.js, test/retry_transaction.integration.test.js.
    const includePayType = Boolean(transaction.payType);
    await db.run(
      `INSERT INTO transactions (type, amount, merchant, category, pay_method, datetime, memo, raw_text, used_point${includePayType ? ', pay_type' : ''}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${includePayType ? ', ?' : ''})`,
      [transaction.type || 'EXPENSE', transaction.amount, transaction.merchant, transaction.category,
        transaction.payMethod, transaction.datetime, transaction.memo || '', rawText, transaction.usedPoint || 0, ...(includePayType ? [transaction.payType] : [])]
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
