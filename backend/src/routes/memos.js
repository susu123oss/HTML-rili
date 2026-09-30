import express from 'express';
import { createHash } from 'crypto';
import { pool, query } from '../db/pool.js';
import { authRequired, canAccessUser, canViewMemo, canEditMemo } from '../middleware/auth.js';

export const memosRouter = express.Router();

const contentPreviewLength = 320;
const maxRangeMonths = 12;

const monthRange = (month) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end };
};

const addMonths = (month, count) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const memoRange = (query) => {
  if (query.startMonth || query.months) {
    const startMonth = String(query.startMonth || '');
    const months = Number(query.months);
    if (!Number.isInteger(months) || months < 1 || months > maxRangeMonths || !monthRange(startMonth)) return null;
    return {
      start: `${startMonth}-01`,
      end: `${addMonths(startMonth, months)}-01`,
      startMonth,
      months
    };
  }

  const range = monthRange(query.month);
  if (!range) return null;
  return { ...range, startMonth: String(query.month), months: 1 };
};

const rowToMemo = (row, includeContent = false) => {
  const content = String(row.content || '');
  const contentPreview = String(row.contentPreview ?? content.slice(0, contentPreviewLength));
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    date: row.date,
    title: row.title,
    contentPreview,
    contentLength: Number(row.contentLength ?? content.length),
    ...(includeContent ? { content } : {}),
    color: row.color,
    completed: row.completed,
    planKind: row.planKind || 'memo',
    rolloverFromId: row.rolloverFromId || null,
    rolloverToId: row.rolloverToId || null,
    rolloverReason: row.rolloverReason || '',
    dueTime: row.dueTime,
    isUrged: Boolean(row.isUrged),
    lastUrgedAt: row.lastUrgedAt || null,
    isReviewed: Boolean(row.isReviewed),
    isLiked: Boolean(row.isLiked),
    expectedDeliverable: row.expectedDeliverable || '',
    actualDeliverable: row.actualDeliverable || '',
    deliveryStatus: row.deliveryStatus || (row.completed ? 'confirmed' : 'in_progress'),
    reviewComment: row.reviewComment || '',
    submittedAt: row.submittedAt || null,
    confirmedAt: row.confirmedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

const memoDetailSql = `
  SELECT memos.id, memos.owner_id AS "ownerId", users.display_name AS "ownerName",
         users.department_id AS "departmentId", departments.name AS "departmentName",
         to_char(memos.date, 'YYYY-MM-DD') AS date,
         memos.title, memos.content, memos.color, memos.completed,
         memos.plan_kind AS "planKind", memos.rollover_from_id AS "rolloverFromId",
         memos.rollover_to_id AS "rolloverToId", memos.rollover_reason AS "rolloverReason",
         memos.due_time AS "dueTime", memos.is_reviewed AS "isReviewed", memos.is_liked AS "isLiked",
         memos.expected_deliverable AS "expectedDeliverable",
         memos.actual_deliverable AS "actualDeliverable",
         memos.delivery_status AS "deliveryStatus",
         memos.review_comment AS "reviewComment",
         memos.submitted_at AS "submittedAt",
         memos.confirmed_at AS "confirmedAt",
         memos.created_at AS "createdAt", memos.updated_at AS "updatedAt"
  FROM memos
  JOIN users ON users.id = memos.owner_id
  LEFT JOIN departments ON departments.id = users.department_id
  WHERE memos.id = $1
`;

async function findMemoById(id, includeContent = true) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return null;
  const result = await query(memoDetailSql, [numId]);
  return result.rowCount ? rowToMemo(result.rows[0], includeContent) : null;
}

async function resolveMemoScope(user, requestedUserId) {
  if (requestedUserId && requestedUserId !== 'all') {
    const userResult = await query('SELECT id, department_id AS "departmentId" FROM users WHERE id = $1', [requestedUserId]);
    if (userResult.rowCount === 0) {
      const error = new Error('成员不存在');
      error.status = 404;
      throw error;
    }
    const target = userResult.rows[0];
    if (!canAccessUser(user, target.id, target.departmentId)) {
      const error = new Error('没有查看该成员记录的权限');
      error.status = 403;
      throw error;
    }
    return { ownerId: Number(target.id) };
  }

  return { ownerId: user.role === 'admin' ? null : Number(user.id) };
}

const normalizeDueTime = (value) => {
  if (!value) return null;
  // pg 返回的 Date 对象直接转 ISO，避免 toString() 产生无法被 PostgreSQL 解析的格式
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  const d = new Date(text);
  if (isNaN(d.getTime())) return null;
  // 统一返回 ISO 8601，防止传入非标准格式的字符串穿透到数据库
  return d.toISOString();
};

function memoQueryScope(range, scope) {
  const params = [range.start, range.end];
  const ownerWhere = scope.ownerId
    ? ` AND memos.owner_id = $${params.push(scope.ownerId)}`
    : '';
  return { params, ownerWhere };
}

function memoEtag(range, scope, includeContent, version) {
  const fingerprint = JSON.stringify({
    range: [range.start, range.end],
    ownerId: scope.ownerId || 'all',
    includeContent,
    count: Number(version.count || 0),
    updatedAt: version.updatedAt || '',
    lastId: Number(version.lastId || 0)
  });
  return `"${createHash('sha1').update(fingerprint).digest('hex')}"`;
}

memosRouter.get('/', authRequired, async (req, res) => {
  const range = memoRange(req.query);
  if (!range) {
    return res.status(400).json({ message: '请传入 month=YYYY-MM，或 startMonth=YYYY-MM 与 months=1-12' });
  }

  const includeContent = req.query.includeContent === '1';
  if (includeContent && req.user.role !== 'admin') {
    return res.status(403).json({ message: '只有管理员可以导出完整任务内容' });
  }

  let scope;
  try {
    scope = await resolveMemoScope(req.user, req.query.userId);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '读取任务范围失败' });
  }

  const { params, ownerWhere } = memoQueryScope(range, scope);
  const versionResult = await query(
    `
    SELECT count(*) AS count,
           COALESCE(max(memos.updated_at)::text, '') AS "updatedAt",
           COALESCE(max(memos.id), 0) AS "lastId"
    FROM memos
    WHERE memos.date >= $1 AND memos.date < $2${ownerWhere}
    `,
    params
  );
  const etag = memoEtag(range, scope, includeContent, versionResult.rows[0] || {});
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'private, no-cache');
  if (req.get('if-none-match') === etag) {
    return res.status(304).end();
  }

  const contentColumns = includeContent
    ? `memos.content, LEFT(memos.content, ${contentPreviewLength}) AS "contentPreview", char_length(memos.content) AS "contentLength"`
    : `LEFT(memos.content, ${contentPreviewLength}) AS "contentPreview", char_length(memos.content) AS "contentLength"`;
  const result = await query(
    `
    SELECT memos.id, memos.owner_id AS "ownerId", users.display_name AS "ownerName",
           users.department_id AS "departmentId", departments.name AS "departmentName",
           to_char(memos.date, 'YYYY-MM-DD') AS date,
           memos.title, ${contentColumns}, memos.color, memos.completed,
           memos.plan_kind AS "planKind", memos.rollover_from_id AS "rolloverFromId",
           memos.rollover_to_id AS "rolloverToId", memos.rollover_reason AS "rolloverReason",
           memos.due_time AS "dueTime", memos.is_reviewed AS "isReviewed", memos.is_liked AS "isLiked",
           memos.expected_deliverable AS "expectedDeliverable",
           memos.actual_deliverable AS "actualDeliverable",
           memos.delivery_status AS "deliveryStatus",
           memos.review_comment AS "reviewComment",
           memos.submitted_at AS "submittedAt",
           memos.confirmed_at AS "confirmedAt",
           memos.created_at AS "createdAt", memos.updated_at AS "updatedAt"
    FROM memos
    JOIN users ON users.id = memos.owner_id
    JOIN departments ON departments.id = users.department_id
    WHERE memos.date >= $1 AND memos.date < $2${ownerWhere}
    ORDER BY memos.date ASC, users.display_name ASC, memos.id ASC
    `,
    params
  );

  return res.json({
    range: { startMonth: range.startMonth, months: range.months },
    memos: result.rows.map((row) => rowToMemo(row, includeContent))
  });
});

// Reminder data is independent of the calendar's visible month and search filter.
memosRouter.get('/reminders', authRequired, async (req, res, next) => {
  try {
    const scope = await resolveMemoScope(req.user, null);
    const params = scope.ownerId ? [scope.ownerId] : [];
    const ownerWhere = scope.ownerId ? ' AND memos.owner_id = $1' : '';
    const result = await query(
      `
      SELECT memos.id, memos.owner_id AS "ownerId", users.display_name AS "ownerName",
             users.department_id AS "departmentId", departments.name AS "departmentName",
             to_char(memos.date, 'YYYY-MM-DD') AS date,
             memos.title, LEFT(memos.content, ${contentPreviewLength}) AS "contentPreview",
             char_length(memos.content) AS "contentLength", memos.color, memos.completed,
             memos.plan_kind AS "planKind", memos.rollover_from_id AS "rolloverFromId",
             memos.rollover_to_id AS "rolloverToId", memos.rollover_reason AS "rolloverReason",
             memos.due_time AS "dueTime", memos.is_reviewed AS "isReviewed", memos.is_liked AS "isLiked",
             memos.expected_deliverable AS "expectedDeliverable",
             memos.actual_deliverable AS "actualDeliverable",
             memos.delivery_status AS "deliveryStatus",
             memos.review_comment AS "reviewComment",
             memos.submitted_at AS "submittedAt",
             memos.confirmed_at AS "confirmedAt",
             memos.created_at AS "createdAt", memos.updated_at AS "updatedAt",
             CASE WHEN latest_urge.created_at IS NOT NULL THEN TRUE ELSE FALSE END AS "isUrged",
             latest_urge.created_at AS "lastUrgedAt"
      FROM memos
      JOIN users ON users.id = memos.owner_id
      LEFT JOIN departments ON departments.id = users.department_id
      LEFT JOIN LATERAL (
        SELECT created_at FROM notifications
        WHERE notifications.memo_id = memos.id AND notifications.type = 'urge'
        ORDER BY created_at DESC LIMIT 1
      ) latest_urge ON TRUE
      WHERE memos.completed = FALSE AND memos.rollover_to_id IS NULL${ownerWhere}
      ORDER BY memos.due_time ASC NULLS LAST, memos.date ASC, memos.id ASC
      `,
      params
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ memos: result.rows.map((row) => rowToMemo(row)) });
  } catch (error) {
    return next(error);
  }
});

// 批量完成任务（管理员可批量完成任意任务，工程师可批量完成无预期交付的日常任务）
memosRouter.post('/batch-complete', authRequired, async (req, res, next) => {
  try {
    const { memoIds } = req.body || {};
    if (!Array.isArray(memoIds) || !memoIds.length) {
      return res.status(400).json({ message: '请提供要完成的任务ID列表' });
    }
    const numIds = memoIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (!numIds.length) {
      return res.status(400).json({ message: '任务ID列表无效' });
    }

    let result;
    if (req.user.role === 'admin') {
      result = await query(
        `
        UPDATE memos
        SET completed = TRUE,
            delivery_status = 'confirmed',
            confirmed_at = COALESCE(confirmed_at, NOW()),
            updated_at = NOW()
        WHERE id = ANY($1::int[]) AND completed = FALSE AND rollover_to_id IS NULL
        RETURNING id
        `,
        [numIds]
      );
    } else {
      result = await query(
        `
        UPDATE memos
        SET completed = TRUE,
            delivery_status = 'confirmed',
            updated_at = NOW()
        WHERE id = ANY($1::int[])
          AND owner_id = $2
          AND completed = FALSE
          AND rollover_to_id IS NULL
          AND BTRIM(COALESCE(expected_deliverable, '')) = ''
        RETURNING id
        `,
        [numIds, req.user.id]
      );
    }

    return res.json({
      ok: true,
      count: result.rowCount,
      updatedIds: result.rows.map((r) => r.id)
    });
  } catch (error) {
    return next(error);
  }
});

// 管理员催办未完成事项（支持催办所选任务或所有逾期任务，下发通知给工程师客户端）
memosRouter.post('/urge', authRequired, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '只有管理员可以发送催办通知' });
    }

    const { memoIds, allOverdue = false } = req.body || {};
    let targetMemos = [];

    if (allOverdue) {
      const queryRes = await query(
        `
        SELECT memos.id, memos.title, memos.owner_id AS "ownerId",
               users.display_name AS "ownerName", memos.due_time AS "dueTime"
        FROM memos
        JOIN users ON users.id = memos.owner_id
        WHERE memos.completed = FALSE AND memos.rollover_to_id IS NULL AND memos.due_time < NOW()
        `
      );
      targetMemos = queryRes.rows;
    } else if (Array.isArray(memoIds) && memoIds.length) {
      const numIds = memoIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
      if (!numIds.length) {
        return res.status(400).json({ message: '催办任务列表无效' });
      }
      const queryRes = await query(
        `
        SELECT memos.id, memos.title, memos.owner_id AS "ownerId",
               users.display_name AS "ownerName", memos.due_time AS "dueTime"
        FROM memos
        JOIN users ON users.id = memos.owner_id
        WHERE memos.id = ANY($1::int[]) AND memos.completed = FALSE AND memos.rollover_to_id IS NULL
        `,
        [numIds]
      );
      targetMemos = queryRes.rows;
    } else {
      return res.status(400).json({ message: '请选择要催办的任务' });
    }

    if (!targetMemos.length) {
      return res.status(400).json({ message: '没有需要催办的未完成任务' });
    }

    const urgedUsers = new Set();
    for (const m of targetMemos) {
      urgedUsers.add(m.ownerName);
      await query(
        `
        INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
        VALUES($1, $2, 'urge', $3, $4, $5, $6)
        `,
        [
          m.ownerId,
          m.id,
          '任务催办提醒',
          `管理员催办了您的任务【${m.title}】，请尽快处理！`,
          req.user.id,
          req.user.displayName || '系统管理员'
        ]
      );
    }

    return res.json({
      ok: true,
      count: targetMemos.length,
      urgedUsers: Array.from(urgedUsers)
    });
  } catch (error) {
    return next(error);
  }
});

const isValidMonday = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
    && date.getUTCDay() === 1;
};

memosRouter.get('/weekly-summaries', authRequired, async (req, res, next) => {
  try {
    const startWeek = String(req.query.startWeek || '');
    const weeks = Number(req.query.weeks || 2);
    if (!isValidMonday(startWeek) || !Number.isInteger(weeks) || weeks < 1 || weeks > 2) {
      return res.status(400).json({ message: '请提供有效的周一日期及 1-2 周范围' });
    }
    const scope = await resolveMemoScope(req.user, req.query.userId);
    const params = [startWeek, weeks];
    const ownerWhere = scope.ownerId ? ` AND owner_id = $${params.push(scope.ownerId)}` : '';
    const result = await query(
      `SELECT owner_id AS "ownerId", to_char(week_start, 'YYYY-MM-DD') AS "weekStart",
              goals, deliverables, actual, risks, updated_at AS "updatedAt"
       FROM weekly_summaries
       WHERE week_start >= $1::date AND week_start < ($1::date + $2::int * 7)${ownerWhere}
       ORDER BY week_start, owner_id`,
      params
    );
    return res.json({ summaries: result.rows });
  } catch (error) {
    return next(error);
  }
});

memosRouter.put('/weekly-summaries/:weekStart', authRequired, async (req, res, next) => {
  try {
    const weekStart = req.params.weekStart;
    const ownerId = Number(req.body?.ownerId || req.user.id);
    if (!isValidMonday(weekStart) || !Number.isInteger(ownerId) || ownerId <= 0) {
      return res.status(400).json({ message: '周计划日期或成员无效' });
    }
    if (!canEditMemo(req.user, ownerId)) {
      return res.status(403).json({ message: '没有编辑该成员周目标的权限' });
    }
    const fields = ['goals', 'deliverables', 'actual', 'risks'].map((key) => String(req.body?.[key] || '').trim());
    if (fields.some((value) => value.length > 5000)) {
      return res.status(400).json({ message: '每项内容最多 5000 字' });
    }
    const result = await query(
      `INSERT INTO weekly_summaries(owner_id, week_start, goals, deliverables, actual, risks)
       VALUES($1, $2, $3, $4, $5, $6)
       ON CONFLICT(owner_id, week_start) DO UPDATE
       SET goals = EXCLUDED.goals, deliverables = EXCLUDED.deliverables,
           actual = EXCLUDED.actual, risks = EXCLUDED.risks, updated_at = NOW()
       RETURNING owner_id AS "ownerId", to_char(week_start, 'YYYY-MM-DD') AS "weekStart",
                 goals, deliverables, actual, risks, updated_at AS "updatedAt"`,
      [ownerId, weekStart, ...fields]
    );
    return res.json({ summary: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

memosRouter.post('/:id/react', authRequired, async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: '仅管理员可进行审阅、点赞与成果确认' });
  }
  const memoId = Number(req.params.id);
  const action = req.body?.action;
  if (!Number.isInteger(memoId) || memoId <= 0 || !['toggle-read', 'toggle-like', 'confirm-delivery', 'return-delivery'].includes(action)) {
    return res.status(400).json({ message: '请求参数无效' });
  }

  try {
    const memoRes = await query(
      `SELECT id, owner_id AS "ownerId", title, is_reviewed AS "isReviewed", is_liked AS "isLiked",
              actual_deliverable AS "actualDeliverable", review_comment AS "reviewComment"
       FROM memos WHERE id = $1`,
      [memoId]
    );
    if (!memoRes.rows.length) {
      return res.status(404).json({ message: '事项不存在' });
    }
    const memo = memoRes.rows[0];
    const senderName = req.user.displayName || req.user.username || '系统管理员';

    let newReviewed = memo.isReviewed;
    let newLiked = memo.isLiked;

    if (action === 'toggle-read') {
      newReviewed = !newReviewed;
      await query(`UPDATE memos SET is_reviewed = $1, updated_at = NOW() WHERE id = $2`, [newReviewed, memoId]);
      if (newReviewed) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'review', $3, $4, $5, $6)`,
          [
            memo.ownerId,
            memo.id,
            '工作事项已审阅',
            `管理员【${senderName}】已审阅您的工作事项【${memo.title}】`,
            req.user.id,
            senderName
          ]
        );
      }
    } else if (action === 'toggle-like') {
      newLiked = !newLiked;
      await query(`UPDATE memos SET is_liked = $1, updated_at = NOW() WHERE id = $2`, [newLiked, memoId]);
      if (newLiked) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'like', $3, $4, $5, $6)`,
          [
            memo.ownerId,
            memo.id,
            '工作点赞 +1',
            `管理员【${senderName}】为您的工作事项【${memo.title}】点赞！`,
            req.user.id,
            senderName
          ]
        );
      }
    } else if (action === 'confirm-delivery') {
      const comment = String(req.body?.reviewComment ?? req.body?.comment ?? memo.reviewComment ?? '').trim().slice(0, 1000);
      newReviewed = true;
      await query(
        `UPDATE memos
         SET completed = TRUE,
             delivery_status = 'confirmed',
             is_reviewed = TRUE,
             review_comment = $1,
             confirmed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [comment, memoId]
      );
      if (Number(memo.ownerId) !== Number(req.user.id)) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'confirm', $3, $4, $5, $6)`,
          [
            memo.ownerId,
            memo.id,
            '✓ 交付成果已确认',
            `管理员【${senderName}】已确认您的任务【${memo.title}】交付成果${comment ? `（备注：${comment}）` : ''}！`,
            req.user.id,
            senderName
          ]
        );
      }
    } else if (action === 'return-delivery') {
      const comment = String(req.body?.reviewComment ?? req.body?.comment ?? '').trim().slice(0, 1000) || '请补充完善实际交付成果后重新提交';
      await query(
        `UPDATE memos
         SET completed = FALSE,
             delivery_status = 'returned',
             review_comment = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [comment, memoId]
      );
      if (Number(memo.ownerId) !== Number(req.user.id)) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'return', $3, $4, $5, $6)`,
          [
            memo.ownerId,
            memo.id,
            '↩ 成果退回修改',
            `管理员【${senderName}】退回了您的任务【${memo.title}】：${comment}`,
            req.user.id,
            senderName
          ]
        );
      }
    }

    const updatedMemo = await findMemoById(memoId);
    return res.json({
      ok: true,
      isReviewed: newReviewed,
      isLiked: newLiked,
      memo: updatedMemo
    });
  } catch (error) {
    return next(error);
  }
});

memosRouter.post('/:id/rollover', authRequired, async (req, res, next) => {
  const targetDate = String(req.body?.targetDate || '');
  const targetDueTime = normalizeDueTime(req.body?.dueTime || `${targetDate}T18:00:00`);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  const memoId = Number(req.params.id);
  const parsedDate = new Date(`${targetDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== targetDate
      || !targetDueTime || !Number.isInteger(memoId) || memoId <= 0) {
    return res.status(400).json({ message: '顺延日期或截止时间无效' });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const sourceResult = await client.query(
      `SELECT id, owner_id AS "ownerId", to_char(date, 'YYYY-MM-DD') AS date,
              title, content, color, completed, plan_kind AS "planKind",
              rollover_to_id AS "rolloverToId",
              expected_deliverable AS "expectedDeliverable"
       FROM memos WHERE id = $1 FOR UPDATE`,
      [memoId]
    );
    const source = sourceResult.rows[0];
    if (!source) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '计划不存在' });
    }
    if (!canEditMemo(req.user, source.ownerId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: '没有顺延该计划的权限' });
    }
    if (source.planKind !== 'plan' || source.completed || source.rolloverToId || targetDate <= source.date) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: '只能将尚未完成且未顺延的计划移至更晚日期' });
    }
    const inserted = await client.query(
      `INSERT INTO memos(owner_id, date, title, content, color, completed, due_time,
                         plan_kind, rollover_from_id, rollover_reason, expected_deliverable, delivery_status)
       VALUES($1, $2, $3, $4, $5, FALSE, $6, 'plan', $7, $8, $9, 'in_progress') RETURNING id`,
      [source.ownerId, targetDate, source.title, source.content, source.color, targetDueTime, memoId, reason, source.expectedDeliverable || '']
    );
    await client.query(
      'UPDATE memos SET rollover_to_id = $2, updated_at = NOW() WHERE id = $1',
      [memoId, inserted.rows[0].id]
    );
    await client.query('COMMIT');
    const [original, successor] = await Promise.all([
      findMemoById(memoId), findMemoById(inserted.rows[0].id)
    ]);
    return res.status(201).json({ original, memo: successor });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return next(error);
  } finally {
    client?.release();
  }
});

memosRouter.get('/:id', authRequired, async (req, res, next) => {
  try {
    const numId = Number(req.params.id);
    if (!Number.isInteger(numId) || numId <= 0) {
      return res.status(404).json({ message: '记录不存在' });
    }
    const memo = await findMemoById(numId, true);
    if (!memo) {
      return res.status(404).json({ message: '记录不存在' });
    }
    if (!canViewMemo(req.user, memo.ownerId, memo.departmentId)) {
      return res.status(403).json({ message: '没有查看该记录的权限' });
    }
    return res.json({ memo });
  } catch (error) {
    return next(error);
  }
});

memosRouter.post('/', authRequired, async (req, res, next) => {
  try {
    const {
      ownerId,
      date,
      title,
      content = '',
      color = '#4f7cff',
      completed = false,
      dueTime = null,
      planKind = 'memo',
      expectedDeliverable = '',
      actualDeliverable = ''
    } = req.body || {};
    const targetOwnerId = ownerId || req.user.id;
    let normalizedDueTime = normalizeDueTime(dueTime);

    if (!date || !title) {
      return res.status(400).json({ message: '日期和标题不能为空' });
    }
    if (!['memo', 'plan'].includes(planKind)) {
      return res.status(400).json({ message: '事项类型无效' });
    }

    if (!normalizedDueTime && date) {
      normalizedDueTime = normalizeDueTime(`${date}T18:00:00`);
    }

    if (!normalizedDueTime) {
      return res.status(400).json({ message: '请添加有效的截止时间' });
    }

    const ownerResult = await query('SELECT id, department_id AS "departmentId" FROM users WHERE id = $1', [targetOwnerId]);
    if (ownerResult.rowCount === 0) {
      return res.status(404).json({ message: '成员不存在' });
    }

    const owner = ownerResult.rows[0];
    if (!canAccessUser(req.user, owner.id, owner.departmentId)) {
      return res.status(403).json({ message: '没有为该成员新增记录的权限' });
    }

    const cleanExpected = String(expectedDeliverable || '').trim().slice(0, 1000);
    const cleanActual = String(actualDeliverable || '').trim().slice(0, 2000);
    const isRoutine = cleanActual === '日常事务（无需交付物）';
    if (req.user.role !== 'admin' && cleanExpected && isRoutine) {
      return res.status(400).json({ message: '此任务设有预期交付，不能选择无需交付审核' });
    }
    let finalCompleted = Boolean(completed);
    let finalDeliveryStatus = finalCompleted ? 'confirmed' : 'in_progress';

    if (req.user.role === 'admin') {
      if (finalCompleted) {
        finalCompleted = true;
        finalDeliveryStatus = 'confirmed';
      } else if (cleanActual && !isRoutine) {
        finalCompleted = false;
        finalDeliveryStatus = 'submitted';
      } else {
        finalCompleted = false;
        finalDeliveryStatus = 'in_progress';
      }
    } else if (cleanActual && !isRoutine) {
      finalCompleted = false;
      finalDeliveryStatus = 'submitted';
    } else if (isRoutine) {
      finalCompleted = Boolean(completed);
      finalDeliveryStatus = finalCompleted ? 'confirmed' : 'in_progress';
    } else {
      finalCompleted = false;
      finalDeliveryStatus = 'in_progress';
    }

    const result = await query(
      `
      INSERT INTO memos(
        owner_id, date, title, content, color, completed, due_time, plan_kind,
        expected_deliverable, actual_deliverable, delivery_status,
        submitted_at, confirmed_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             CASE WHEN $11 = 'submitted' THEN NOW() ELSE NULL END,
             CASE WHEN $11 = 'confirmed' AND $6 = TRUE THEN NOW() ELSE NULL END)
      RETURNING id
      `,
      [owner.id, date, title, content, color, finalCompleted, normalizedDueTime, planKind, cleanExpected, cleanActual, finalDeliveryStatus]
    );

    const newId = result.rows[0].id;
    if (finalDeliveryStatus === 'submitted' && req.user.role !== 'admin') {
      const adminsRes = await query(`SELECT id FROM users WHERE role = 'admin'`);
      const ownerLabel = req.user.displayName || req.user.username || '成员';
      for (const admin of adminsRes.rows) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'submit', $3, $4, $5, $6)`,
          [
            admin.id,
            newId,
            '📦 交付成果待确认',
            `【${ownerLabel}】提交了事项【${title}】的交付审核：${cleanActual.slice(0, 120)}`,
            req.user.id,
            ownerLabel
          ]
        );
      }
    }

    const memo = await findMemoById(newId);
    return res.status(201).json({ id: newId, memo });
  } catch (error) {
    return next(error);
  }
});

async function handleUpdateMemo(req, res, next) {
  try {
    const numId = Number(req.params.id);
    if (!Number.isInteger(numId) || numId <= 0) {
      return res.status(404).json({ message: '记录不存在' });
    }
    const memoResult = await query(
      `
      SELECT memos.id, memos.owner_id AS "ownerId", users.display_name AS "ownerName",
             users.department_id AS "departmentId",
             memos.title, memos.completed,
             memos.due_time AS "dueTime", to_char(memos.date, 'YYYY-MM-DD') AS date,
             memos.rollover_to_id AS "rolloverToId", memos.rollover_from_id AS "rolloverFromId",
             memos.expected_deliverable AS "expectedDeliverable",
             memos.actual_deliverable AS "actualDeliverable",
             memos.delivery_status AS "deliveryStatus",
             memos.review_comment AS "reviewComment"
      FROM memos
      JOIN users ON users.id = memos.owner_id
      WHERE memos.id = $1
      `,
      [numId]
    );

    if (memoResult.rowCount === 0) {
      return res.status(404).json({ message: '记录不存在' });
    }

    const memo = memoResult.rows[0];
    if (!canEditMemo(req.user, memo.ownerId)) {
      return res.status(403).json({ message: '没有修改该记录的权限' });
    }
    if (memo.rolloverToId) {
      return res.status(409).json({ message: '已顺延的原计划不能修改，请编辑顺延后的事项' });
    }

    const {
      date,
      title,
      content,
      color,
      completed,
      dueTime,
      planKind,
      expectedDeliverable,
      actualDeliverable,
      deliveryStatus,
      reviewComment
    } = req.body || {};

    if (planKind !== undefined && !['memo', 'plan'].includes(planKind)) {
      return res.status(400).json({ message: '事项类型无效' });
    }
    if (memo.rolloverFromId && planKind === 'memo') {
      return res.status(409).json({ message: '顺延事项必须保留计划类型' });
    }
    const hasDueTime = Object.prototype.hasOwnProperty.call(req.body || {}, 'dueTime');
    let normalizedDueTime = normalizeDueTime(hasDueTime ? dueTime : memo.dueTime);
    if (!normalizedDueTime && (date || memo.date)) {
      normalizedDueTime = normalizeDueTime(`${date || memo.date}T18:00:00`);
    }
    if (!normalizedDueTime) {
      return res.status(400).json({ message: '请添加有效的截止时间' });
    }

    const nextExpected = expectedDeliverable !== undefined
      ? String(expectedDeliverable || '').trim().slice(0, 1000)
      : String(memo.expectedDeliverable || '').trim();
    const nextActual = actualDeliverable !== undefined
      ? String(actualDeliverable || '').trim().slice(0, 2000)
      : String(memo.actualDeliverable || '').trim();
    const nextComment = reviewComment !== undefined
      ? String(reviewComment || '').trim().slice(0, 1000)
      : String(memo.reviewComment || '').trim();

    if (req.user.role !== 'admin') {
      if (memo.expectedDeliverable && nextExpected !== String(memo.expectedDeliverable).trim()) {
        return res.status(403).json({ message: '已有的预期交付要求仅管理员可修改' });
      }
      if (nextComment !== String(memo.reviewComment || '').trim()) {
        return res.status(403).json({ message: '验收意见仅管理员可修改' });
      }
      if (nextExpected && nextActual === '日常事务（无需交付物）') {
        return res.status(400).json({ message: '此任务设有预期交付，不能选择无需交付审核' });
      }
    }

    const isRoutine = nextActual === '日常事务（无需交付物）';
    let nextCompleted = typeof completed === 'boolean' ? completed : Boolean(memo.completed);
    let nextDeliveryStatus = memo.deliveryStatus || (memo.completed ? 'confirmed' : 'in_progress');
    let markSubmittedNow = false;
    let markConfirmedNow = false;

    if (req.user.role === 'admin') {
      if (deliveryStatus === 'confirmed' || (completed === true && deliveryStatus !== 'submitted' && deliveryStatus !== 'returned')) {
        nextDeliveryStatus = 'confirmed';
        nextCompleted = true;
        markConfirmedNow = memo.deliveryStatus !== 'confirmed' || !memo.completed;
      } else if (deliveryStatus === 'returned') {
        nextDeliveryStatus = 'returned';
        nextCompleted = false;
      } else if (deliveryStatus === 'submitted' || (actualDeliverable !== undefined && nextActual && !isRoutine && !nextCompleted)) {
        nextDeliveryStatus = 'submitted';
        nextCompleted = false;
        markSubmittedNow = memo.deliveryStatus !== 'submitted';
      } else if (completed === false || deliveryStatus === 'in_progress') {
        nextDeliveryStatus = 'in_progress';
        nextCompleted = false;
      }
    } else {
      // 员工操作：根据「成果交付」下拉框选择决定状态流转
      const actualChanged = nextActual !== String(memo.actualDeliverable || '').trim();
      const wantsReopen = deliveryStatus === 'in_progress' || (completed === false && deliveryStatus === undefined && memo.completed);
      if (!actualChanged && memo.completed && completed !== false && deliveryStatus !== 'submitted' && deliveryStatus !== 'in_progress') {
        nextCompleted = true;
        nextDeliveryStatus = 'confirmed';
      } else if (!actualChanged && deliveryStatus === undefined && completed === undefined) {
        nextCompleted = Boolean(memo.completed);
      } else if (!actualChanged && memo.deliveryStatus === 'returned' && deliveryStatus === 'returned') {
        nextDeliveryStatus = 'returned';
        nextCompleted = false;
      } else if (wantsReopen) {
        nextDeliveryStatus = 'in_progress';
        nextCompleted = false;
      } else if (nextActual && !isRoutine) {
        if (!actualChanged && memo.completed && completed !== false && deliveryStatus !== 'submitted') {
          nextDeliveryStatus = 'confirmed';
          nextCompleted = true;
        } else {
          nextDeliveryStatus = 'submitted';
          nextCompleted = false;
          markSubmittedNow = memo.deliveryStatus !== 'submitted' || nextActual !== String(memo.actualDeliverable || '').trim();
        }
      } else if (isRoutine) {
        nextCompleted = typeof completed === 'boolean' ? completed : Boolean(memo.completed);
        nextDeliveryStatus = nextCompleted ? 'confirmed' : 'in_progress';
        if (nextCompleted && !memo.completed) markConfirmedNow = true;
      } else {
        if (completed === true || deliveryStatus === 'submitted') {
          return res.status(400).json({ message: '请先在【成果交付】下拉框选择交付状态（如：已经邮件交付审核 / 已经微信发送审核）' });
        }
        nextCompleted = false;
        nextDeliveryStatus = 'in_progress';
      }
    }

    await query(
      `
      UPDATE memos
      SET date = COALESCE($2, date),
          title = COALESCE($3, title),
          content = COALESCE($4, content),
          color = COALESCE($5, color),
          completed = $6,
          due_time = CASE WHEN $7 THEN $8::timestamptz ELSE due_time END,
          plan_kind = COALESCE($9, plan_kind),
          expected_deliverable = $10,
          actual_deliverable = $11,
          delivery_status = $12,
          review_comment = $13,
          submitted_at = CASE WHEN $14 THEN NOW() ELSE submitted_at END,
          confirmed_at = CASE WHEN $15 THEN NOW() WHEN NOT $6 THEN NULL ELSE confirmed_at END,
          is_reviewed = CASE WHEN $15 THEN TRUE WHEN $14 THEN FALSE ELSE is_reviewed END,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        numId,
        date || null,
        title || null,
        content ?? null,
        color || null,
        nextCompleted,
        hasDueTime,
        hasDueTime ? normalizedDueTime : null,
        planKind ?? null,
        nextExpected,
        nextActual,
        nextDeliveryStatus,
        nextComment,
        markSubmittedNow,
        markConfirmedNow
      ]
    );

    if (markSubmittedNow && req.user.role !== 'admin') {
      const adminsRes = await query(`SELECT id FROM users WHERE role = 'admin'`);
      const ownerLabel = memo.ownerName || req.user.displayName || req.user.username || '成员';
      const memoTitle = title || memo.title;
      for (const admin of adminsRes.rows) {
        await query(
          `INSERT INTO notifications(user_id, memo_id, type, title, content, sender_id, sender_name)
           VALUES($1, $2, 'submit', $3, $4, $5, $6)`,
          [
            admin.id,
            numId,
            '📦 交付成果待确认',
            `【${ownerLabel}】已提交事项【${memoTitle}】的实际成果：${nextActual.slice(0, 120)}`,
            req.user.id,
            ownerLabel
          ]
        );
      }
    }

    const updatedMemo = await findMemoById(numId);
    return res.json({ ok: true, memo: updatedMemo });
  } catch (error) {
    return next(error);
  }
}

memosRouter.patch('/:id', authRequired, handleUpdateMemo);
memosRouter.put('/:id', authRequired, handleUpdateMemo);

memosRouter.delete('/:id', authRequired, async (req, res, next) => {
  try {
    const numId = Number(req.params.id);
    if (!Number.isInteger(numId) || numId <= 0) {
      return res.status(404).json({ message: '记录不存在' });
    }
    const memoResult = await query(
      `
      SELECT memos.id, memos.owner_id AS "ownerId", users.department_id AS "departmentId",
             memos.rollover_to_id AS "rolloverToId", memos.rollover_from_id AS "rolloverFromId"
      FROM memos
      JOIN users ON users.id = memos.owner_id
      WHERE memos.id = $1
      `,
      [numId]
    );

    if (memoResult.rowCount === 0) {
      return res.status(404).json({ message: '记录不存在' });
    }

    const memo = memoResult.rows[0];
    if (!canEditMemo(req.user, memo.ownerId)) {
      return res.status(403).json({ message: '没有删除该记录的权限' });
    }
    if (memo.rolloverToId || memo.rolloverFromId) {
      return res.status(409).json({ message: '顺延链中的计划需保留以供复盘' });
    }

    await query('DELETE FROM memos WHERE id = $1', [numId]);
    return res.json({ ok: true, id: numId });
  } catch (error) {
    return next(error);
  }
});
