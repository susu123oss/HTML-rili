import express from 'express';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

export const notificationsRouter = express.Router();

// 获取当前登录用户的所有未读消息提醒
notificationsRouter.get('/', authRequired, async (req, res, next) => {
  try {
    const result = await query(
      `
      SELECT id, memo_id AS "memoId", type, title, content,
             sender_name AS "senderName", is_read AS "isRead",
             created_at AS "createdAt"
      FROM notifications
      WHERE user_id = $1 AND is_read = FALSE
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
