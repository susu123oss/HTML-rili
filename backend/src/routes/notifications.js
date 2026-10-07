import express from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

export const notificationsRouter = express.Router();

notificationsRouter.get('/history', authRequired, async (req, res, next) => {
  try {
    const before = req.query.before == null ? null : Number(req.query.before);
    if (before != null && (!Number.isSafeInteger(before) || before <= 0)) {
      return res.status(400).json({ message: '消息分页编号不正确' });
    }
    const result = await query(`
      SELECT id, memo_id AS "memoId", type, title, content,
        sender_name AS "senderName", is_read AS "isRead", created_at AS "createdAt"
      FROM notifications WHERE user_id = $1 AND cleared_at IS NULL AND ($2::int IS NULL OR id < $2)
      ORDER BY id DESC LIMIT 51`, [req.user.id, before]);
    const notifications = result.rows.slice(0, 50);
    return res.json({ notifications, nextCursor: result.rows.length > 50 ? notifications.at(-1).id : null });
  } catch (error) { return next(error); }
});

// Hide this recipient's existing messages; retain source records for task urge history.
notificationsRouter.post('/clear', authRequired, async (req, res, next) => {
  try {
    const throughId = Number(req.body?.throughId);
    if (!Number.isInteger(throughId) || throughId <= 0 || throughId > 2147483647) {
      return res.status(400).json({ message: '请先加载消息记录后再清空' });
    }
    const result = await query(`
      UPDATE notifications SET cleared_at = NOW(), is_read = TRUE
      WHERE user_id = $1 AND id <= $2 AND cleared_at IS NULL`, [req.user.id, throughId]);
    return res.json({ ok: true, count: result.rowCount });
  } catch (error) { return next(error); }
});

// 获取当前登录用户的所有未读消息提醒
notificationsRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const result = await query(
      `
      SELECT id, memo_id AS "memoId", type, title, content,
             sender_name AS "senderName", is_read AS "isRead",
             created_at AS "createdAt"
      FROM notifications
      WHERE user_id = $1 AND is_read = FALSE AND cleared_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [req.user.id]
    );

    return res.json({ notifications: result.rows });
  } catch (error) {
    return next(error);
  }
});

// 标记消息为已读
notificationsRouter.post('/read', authRequired, async (req, res, next) => {
  try {
    const { ids, all = false } = req.body || {};

    if (all) {
      await query(
        `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
        [req.user.id]
      );
      return res.json({ ok: true });
    }

    if (Array.isArray(ids) && ids.length) {
      const numIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
      if (numIds.length) {
        await query(
          `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND id = ANY($2::int[])`,
          [req.user.id, numIds]
        );
      }
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
