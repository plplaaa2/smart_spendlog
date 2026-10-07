// Own rules-table scheduling migrations and active-rule query ordering.
// Related files: database/connection.js, routes/webhook.js, routes/rules.js.
async function migrateRuleMetadata(db, username = 'admin') {
  const columns = await db.all('PRAGMA table_info(rules)');
  const names = new Set(columns.map(column => column.name));

  if (!names.has('priority')) await db.exec('ALTER TABLE rules ADD COLUMN priority INTEGER DEFAULT 100');
  if (!names.has('enabled')) await db.exec('ALTER TABLE rules ADD COLUMN enabled INTEGER DEFAULT 1');
  if (!names.has('source')) await db.exec("ALTER TABLE rules ADD COLUMN source TEXT DEFAULT 'USER'");

  console.log(`[DB 마이그레이션][${username}] rules 스케줄링 메타데이터 확인 완료.`);
}

async function getActiveRules(db) {
  return db.all('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority ASC, id ASC');
}

module.exports = { migrateRuleMetadata, getActiveRules };
