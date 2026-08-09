/**
 * @file routes/notifications.js
 * @summary 인앱 알림 센터 제어 API 라우터
 * @description 예산 초과, 순수이익 적자, 카드 실적 달성 및 미분류 거래 발생에 대한 인앱 알림 관리 API를 제공합니다.
 * @dependencies
 *   - database.js: getDB
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../database');

// 알림 목록 및 읽지 않은 개수 조회
router.get('/notifications', async (req, res) => {
  try {
    const db = await getDB(req.username);
    if (!db) {
      return res.status(500).json({ error: '데이터베이스 연결 실패' });
    }

    // 최근 30개의 알림 조회 (타임스탬프 역순)
    const list = await db.all(
      'SELECT id, type, title, message, is_read, created_at FROM inapp_notifications ORDER BY datetime(created_at) DESC, id DESC LIMIT 30'
    );

    // 읽지 않은 알림 개수 조회
    const unreadRow = await db.get(
      'SELECT COUNT(*) as count FROM inapp_notifications WHERE is_read = 0'
    );
    const unreadCount = unreadRow ? unreadRow.count || 0 : 0;

    res.json({
      success: true,
      list,
      unreadCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 알림 읽음 처리
router.post('/notifications/read', async (req, res) => {
  try {
    const db = await getDB(req.username);
    if (!db) {
      return res.status(500).json({ error: '데이터베이스 연결 실패' });
    }

    const { id, all } = req.body;

    if (all) {
      await db.run('UPDATE inapp_notifications SET is_read = 1 WHERE is_read = 0');
    } else if (id) {
      await db.run('UPDATE inapp_notifications SET is_read = 1 WHERE id = ?', [id]);
    } else {
      return res.status(400).json({ error: 'id 또는 all 속성을 지정해야 합니다.' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 알림 삭제 처리
router.post('/notifications/delete', async (req, res) => {
  try {
    const db = await getDB(req.username);
    if (!db) {
      return res.status(500).json({ error: '데이터베이스 연결 실패' });
    }

    const { id, all } = req.body;

    if (all) {
      await db.run('DELETE FROM inapp_notifications');
    } else if (id) {
      await db.run('DELETE FROM inapp_notifications WHERE id = ?', [id]);
    } else {
      return res.status(400).json({ error: 'id 또는 all 속성을 지정해야 합니다.' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
