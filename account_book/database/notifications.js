const { getDB } = require('./connection');

async function createInAppNotification(username, type, title, message) {
  try {
    const db = await getDB(username);
    if (!db) return;

    await db.run(
      'INSERT INTO inapp_notifications (type, title, message) VALUES (?, ?, ?)',
      [type, title, message]
    );

    await db.run(
      "DELETE FROM inapp_notifications WHERE created_at < datetime('now', '-30 days')"
    );
  } catch (err) {
    console.error(`[InApp Notification][${username}] 알림 생성 중 오류:`, err);
  }
}

module.exports = {
  createInAppNotification
};
