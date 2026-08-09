const { getDB } = require('./connection');

async function getLoginSecurity(target) {
  const db = await getDB('admin');
  const row = await db.get('SELECT * FROM login_security WHERE target = ?', [target]);
  if (row) {
    return row;
  }
  return {
    target,
    type: (target.includes('.') || target.includes(':')) ? 'IP' : 'USER',
    fail_count: 0,
    last_failed_at: 0,
    banned_until: 0
  };
}

async function updateLoginSecurity(target, type, failCount, lastFailedAt, bannedUntil) {
  const db = await getDB('admin');
  await db.run(
    'INSERT OR REPLACE INTO login_security (target, type, fail_count, last_failed_at, banned_until) VALUES (?, ?, ?, ?, ?)',
    [target, type, failCount, lastFailedAt, bannedUntil]
  );
}

async function clearLoginSecurity(target) {
  const db = await getDB('admin');
  await db.run('DELETE FROM login_security WHERE target = ?', [target]);
}

module.exports = {
  getLoginSecurity,
  updateLoginSecurity,
  clearLoginSecurity
};
