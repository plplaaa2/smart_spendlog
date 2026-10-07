// Pair check-card and bank notifications without changing the debit account.
// Related: routes/webhook.js, routes/settings.js, public/settings.js.
const { CARD_TO_BANK_MAP } = require('../parser/constants');
function describeNotification(provider, type, text, transactionType) {
  if (transactionType !== 'EXPENSE') return null;
  if (type === 'CHECK' && /카드/.test(provider)) {
    const bank = CARD_TO_BANK_MAP[provider];
    return bank && bank !== '계좌이체' ? {source:'card', bank} : null;
  }
  if (!/카드/.test(provider) && /은행|뱅크|농협|우체국|새마을금고|신협|수협/.test(provider) && /출금/.test(text)) {
    return {source:'bank', bank:provider};
  }
  return null;
}
// Allow delayed delivery only with explicit matching transaction timestamps and one candidate.
// Related: routes/webhook.js, parser/text_parser.js, test/check_notification.test.js.
async function findPair(db, notification, amount, now, datetime = null, rawText = '') {
  await db.run(`CREATE TABLE IF NOT EXISTS check_notification_pairs (
    transaction_id INTEGER PRIMARY KEY, source TEXT, bank TEXT, amount REAL,
    received_at INTEGER, paired INTEGER DEFAULT 0, sender TEXT, raw_text TEXT)`);
  if (!notification) return null;
  const hasTransactionTime = /\d{1,2}[/.\-]\d{1,2}\s+\d{2}:\d{2}/.test(rawText);
  const candidates = await db.all(`SELECT p.*, t.datetime AS transaction_datetime FROM check_notification_pairs p
    JOIN transactions t ON t.id = p.transaction_id AND t.raw_text = p.raw_text
    WHERE p.paired = 0 AND p.source != ? AND p.bank = ? AND p.amount = ?
      AND p.received_at BETWEEN ? AND ? AND t.type = 'EXPENSE'
      AND t.category NOT IN ('이체/송금','ATM/출금','카드상환')
    ORDER BY p.received_at DESC, p.transaction_id DESC`,
    [notification.source,notification.bank,amount,now-300000,now]);
  const eligible = candidates.filter(pair => {
    const previousHasTime = /\d{1,2}[/.\-]\d{1,2}\s+\d{2}:\d{2}/.test(pair.raw_text || '');
    if (hasTransactionTime && previousHasTime) return datetime === pair.transaction_datetime;
    return now - pair.received_at <= 60000;
  });
  return eligible.length === 1 ? eligible[0] : null;
}
async function remember(db, id, notification, amount, now, sender, raw) {
  if (!notification) return;
  await db.run('INSERT OR REPLACE INTO check_notification_pairs (transaction_id, source, bank, amount, received_at, paired, sender, raw_text) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    [id,notification.source,notification.bank,amount,now,sender,raw]);
}
module.exports = {describeNotification,findPair,remember};
