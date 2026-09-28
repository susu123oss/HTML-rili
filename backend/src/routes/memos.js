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
         memos.due_time AS "dueTime", memos.created_at AS "createdAt", memos.updated_at AS "updatedAt"
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
  const text = String(value || '').trim();
  if (!text || Number.isNaN(new Date(text).getTime())) return null;
  return text;
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
           memos.due_time AS "dueTime", memos.created_at AS "createdAt", memos.updated_at AS "updatedAt"
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
             memos.due_time AS "dueTime", memos.created_at AS "createdAt", memos.updated_at AS "updatedAt",
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

// 批量完成任务（管理员可批量完成任意任务，工程师可批量完成名下任务）
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
        SET completed = TRUE, updated_at = NOW()
        WHERE id = ANY($1::int[]) AND completed = FALSE AND rollover_to_id IS NULL
        RETURNING id
        `,
        [numIds]
      );
    } else {
      result = await query(
        `
        UPDATE memos
        SET completed = TRUE, updated_at = NOW()
        WHERE id = ANY($1::int[]) AND owner_id = $2 AND completed = FALSE AND rollover_to_id IS NULL
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
              rollover_to_id AS "rolloverToId"
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
                         plan_kind, rollover_from_id, rollover_reason)
       VALUES($1, $2, $3, $4, $5, FALSE, $6, 'plan', $7, $8) RETURNING id`,
      [source.ownerId, targetDate, source.title, source.content, source.color, targetDueTime, memoId, reason]
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
    const { ownerId, date, title, content = '', color = '#4f7cff', completed = false, dueTime = null, planKind = 'memo' } = req.body || {};
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

    const result = await query(
      `
      INSERT INTO memos(owner_id, date, title, content, color, completed, due_time, plan_kind)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [owner.id, date, title, content, color, completed, normalizedDueTime, planKind]
    );

    const memo = await findMemoById(result.rows[0].id);
    return res.status(201).json({ id: result.rows[0].id, memo });
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
      SELECT memos.id, memos.owner_id AS "ownerId", users.department_id AS "departmentId",
             memos.due_time AS "dueTime", to_char(memos.date, 'YYYY-MM-DD') AS date,
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
      return res.status(403).json({ message: '没有修改该记录的权限' });
    }
    if (memo.rolloverToId) {
      return res.status(409).json({ message: '已顺延的原计划不能修改，请编辑顺延后的事项' });
    }

    const { date, title, content, color, completed, dueTime, planKind } = req.body || {};
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

    await query(
      `
      UPDATE memos
      SET date = COALESCE($2, date),
          title = COALESCE($3, title),
          content = COALESCE($4, content),
          color = COALESCE($5, color),
          completed = COALESCE($6, completed),
          due_time = CASE WHEN $7 THEN $8 ELSE due_time END,
          plan_kind = COALESCE($9, plan_kind),
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        numId,
        date || null,
        title || null,
        content ?? null,
        color || null,
        typeof completed === 'boolean' ? completed : null,
        hasDueTime,
        normalizedDueTime,
        planKind ?? null
      ]
    );

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
