// Atomically store a parsed Webhook transaction and its notification log.
// Related file: routes/webhook.js; related tables: transactions, notification_logs.
async function storeWebhookTransaction(db, { transaction, notification }) {
  await db.run('BEGIN TRANSACTION');
  try {
    const insertResult = await db.run(
      'INSERT INTO transactions (type, amount, merchant, category, pay_method, pay_type, datetime, memo, raw_text, used_point, original_amount, currency, exchange_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transaction.type || 'EXPENSE', transaction.amount, transaction.merchant,
        transaction.category, transaction.payMethod, transaction.payType,
        transaction.datetime, transaction.memo || '', transaction.rawText,
        transaction.usedPoint || 0, transaction.originalAmount,
        transaction.currency, transaction.exchangeRate]
    );
    await db.run(
      'INSERT INTO notification_logs (sender, raw_text, title, text, parsed_status, matched_rule_id) VALUES (?, ?, ?, ?, ?, ?)',
      [notification.sender, transaction.rawText, notification.title, notification.text,
        notification.parsedStatus, notification.matchedRuleId]
    );
    await db.run('COMMIT');
    return insertResult;
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  }
}

module.exports = { storeWebhookTransaction };
