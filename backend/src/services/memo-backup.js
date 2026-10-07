import { createHash, randomUUID } from 'node:crypto';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function timestamp(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') fail(`${label}格式不正确`);
  // Older files used China local datetime strings without a timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/.test(value)
    ? `${value.replace(' ', 'T')}+08:00` : value;
  if (!validDate(value.slice(0, 10)) || Number.isNaN(Date.parse(normalized))) fail(`${label}格式不正确`);
  return new Date(normalized).toISOString();
}

export async function exportMemoBackup(db, memoIds, scope) {
  if (!Array.isArray(memoIds) || memoIds.length > 20000) fail('请选择不超过 20000 条记录');
  const ids = [...new Set(memoIds.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) fail('事项编号不正确');
  const result = await db.query(`
    WITH RECURSIVE family(id) AS (
      SELECT id FROM memos WHERE id = ANY($1::int[])
      UNION
      SELECT m.id FROM memos m JOIN family f
        ON m.rollover_from_id = f.id OR m.rollover_to_id = f.id
    )
    SELECT m.id, m.owner_id AS "ownerId", u.username AS "ownerUsername",
      u.display_name AS "ownerName", to_char(m.date, 'YYYY-MM-DD') AS date,
      m.title, m.content, m.color, m.completed, m.due_time AS "dueTime",
      m.plan_kind AS "planKind", m.rollover_from_id AS "rolloverFromId",
      m.rollover_to_id AS "rolloverToId", m.rollover_reason AS "rolloverReason",
      m.expected_deliverable AS "expectedDeliverable", m.actual_deliverable AS "actualDeliverable",
      m.delivery_status AS "deliveryStatus", m.review_comment AS "reviewComment",
      m.is_reviewed AS "isReviewed", m.is_liked AS "isLiked",
      m.submitted_at AS "submittedAt", m.confirmed_at AS "confirmedAt",
      m.created_at AS "createdAt", m.updated_at AS "updatedAt"
    FROM memos m JOIN family f ON f.id = m.id JOIN users u ON u.id = m.owner_id
    ORDER BY m.id`, [ids]);
  if (ids.some((id) => !result.rows.some((memo) => memo.id === id))) fail('部分事项已被删除，请刷新后重新导出', 409);
  const summaries = await db.query(`
    SELECT u.username AS "ownerUsername", to_char(s.week_start, 'YYYY-MM-DD') AS "weekStart",
      s.goals, s.deliverables, s.actual, s.risks, s.updated_at AS "updatedAt"
    FROM weekly_summaries s JOIN users u ON u.id = s.owner_id
    WHERE EXISTS (SELECT 1 FROM memos m WHERE m.id = ANY($1::int[])
      AND m.owner_id = s.owner_id AND date_trunc('week', m.date)::date = s.week_start)
    ORDER BY s.owner_id, s.week_start`, [result.rows.map((memo) => memo.id)]);
  return {
    format: 'work-calendar-backup', version: 2, backupId: randomUUID(),
    exportedAt: new Date().toISOString(), scope,
    selectedCount: ids.length, memos: result.rows, weeklySummaries: summaries.rows
  };
}

export function validateMemoBackup(payload) {
  const modern = payload?.version === 2 && payload?.format === 'work-calendar-backup';
  if (payload?.version > 2) fail('此备份版本暂不支持');
  const rows = Array.isArray(payload) ? payload : payload?.memos;
  if (!Array.isArray(rows) || !rows.length || rows.length > 20000) fail('备份需包含 1 至 20000 条事项');
  const ids = new Set();
  const memos = rows.map((memo, index) => {
    const label = `第 ${index + 1} 条事项`;
    const id = memo.id ?? `legacy-${index}`;
    if (ids.has(String(id))) fail(`${label}编号重复`);
    ids.add(String(id));
    if (typeof memo.title !== 'string' || !memo.title.trim() || !validDate(memo.date)) fail(`${label}缺少标题或有效日期`);
    if (typeof memo.content !== 'string') fail(`${label}未包含完整正文。旧版摘要备份无法恢复正文，请重新导出完整备份`);
    const planKind = memo.planKind || (memo.title.startsWith('[计划]') ? 'plan' : 'memo');
    if (!['memo', 'plan'].includes(planKind)) fail(`${label}事项类型不正确`);
    const deliveryStatus = memo.deliveryStatus || (memo.completed ? 'confirmed' : 'in_progress');
    if (!['in_progress', 'submitted', 'confirmed', 'returned'].includes(deliveryStatus)) fail(`${label}交付状态不正确`);
    for (const key of ['completed', 'isReviewed', 'isLiked']) {
      if (memo[key] != null && typeof memo[key] !== 'boolean') fail(`${label}${key}格式不正确`);
    }
    for (const key of ['color', 'expectedDeliverable', 'actualDeliverable', 'reviewComment', 'rolloverReason']) {
      if (memo[key] != null && typeof memo[key] !== 'string') fail(`${label}${key}格式不正确`);
    }
    return {
      ...memo, id, planKind, deliveryStatus,
      dueTime: timestamp(memo.dueTime, `${label}截止时间`),
      submittedAt: timestamp(memo.submittedAt, `${label}提交时间`),
      confirmedAt: timestamp(memo.confirmedAt, `${label}确认时间`),
      createdAt: timestamp(memo.createdAt, `${label}创建时间`),
      updatedAt: timestamp(memo.updatedAt, `${label}更新时间`)
    };
  });
  const byId = new Map(memos.map((memo) => [String(memo.id), memo]));
  for (const memo of memos) {
    for (const [key, inverse] of [['rolloverFromId', 'rolloverToId'], ['rolloverToId', 'rolloverFromId']]) {
      if (memo[key] == null) continue;
      const related = byId.get(String(memo[key]));
      if (!related || String(related[inverse]) !== String(memo.id)) fail('结转关联不完整，请导出包含原事项与后续事项的完整备份');
      if (related.ownerUsername !== memo.ownerUsername || related.ownerId !== memo.ownerId) fail('结转关联的负责人不一致');
      if (key === 'rolloverToId' && related.date <= memo.date) fail('结转事项日期必须晚于原事项');
    }
  }
  const summaries = modern ? (payload.weeklySummaries || []) : [];
  if (!Array.isArray(summaries)) fail('周计划总结格式不正确');
  const summaryKeys = new Set();
  for (const summary of summaries) {
    if (!summary.ownerUsername || !validDate(summary.weekStart)
      || new Date(`${summary.weekStart}T00:00:00Z`).getUTCDay() !== 1) fail('周计划总结缺少账号或有效周起始日');
    const key = `${summary.ownerUsername}:${summary.weekStart}`;
    if (summaryKeys.has(key)) fail('周计划总结重复');
    summaryKeys.add(key);
    for (const field of ['goals', 'deliverables', 'actual', 'risks']) {
      if (typeof summary[field] !== 'string') fail('周计划总结字段不完整');
    }
    summary.updatedAt = timestamp(summary.updatedAt, '周计划总结更新时间');
  }
  if (modern && (typeof payload.backupId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(payload.backupId))) fail('备份标识不正确');
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { memos, summaries, modern, fingerprint, backupId: modern ? payload.backupId : `legacy-${fingerprint}` };
}

export async function importMemoBackup(pool, payload, importedBy) {
  const backup = validateMemoBackup(payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [backup.backupId]);
    const previous = await client.query('SELECT fingerprint, imported_ids FROM memo_backup_imports WHERE backup_id = $1', [backup.backupId]);
    if (previous.rows.length) {
      if (previous.rows[0].fingerprint !== backup.fingerprint) fail('同一备份标识的内容已变化，请使用原文件或重新导出', 409);
      await client.query('COMMIT');
      return { ok: true, reused: true, count: previous.rows[0].imported_ids.length, summaryCount: 0 };
    }
    const users = (await client.query('SELECT id, username, display_name FROM users')).rows;
    function resolveOwner(memo) {
      if (memo.ownerUsername) {
        const user = users.find((item) => item.username === memo.ownerUsername);
        if (user) return user.id;
      } else if (!backup.modern) {
        const matches = users.filter((item) => item.username === memo.ownerName || item.display_name === memo.ownerName);
        if (matches.length === 1) return matches[0].id;
        if (!memo.ownerName) {
          const user = users.find((item) => item.id === Number(memo.ownerId));
          if (user) return user.id;
        }
      }
      fail(`账号 ${memo.ownerUsername || memo.ownerName || memo.ownerId || '未知'} 无法匹配，请先创建对应账号`);
    }
    const idMap = new Map();
    for (const memo of backup.memos) {
      const result = await client.query(`
        INSERT INTO memos(owner_id, date, title, content, color, completed, due_time, plan_kind,
          rollover_reason, expected_deliverable, actual_deliverable, delivery_status, review_comment,
          is_reviewed, is_liked, submitted_at, confirmed_at, created_at, updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18::timestamptz,NOW()),COALESCE($19::timestamptz,NOW())) RETURNING id`,
      [resolveOwner(memo), memo.date, memo.title, memo.content, memo.color || '#4f7cff',
        Boolean(memo.completed), memo.dueTime, memo.planKind, memo.rolloverReason || '',
        memo.expectedDeliverable || '', memo.actualDeliverable || '', memo.deliveryStatus, memo.reviewComment || '',
        Boolean(memo.isReviewed), Boolean(memo.isLiked), memo.submittedAt, memo.confirmedAt, memo.createdAt, memo.updatedAt]);
      idMap.set(String(memo.id), result.rows[0].id);
    }
    for (const memo of backup.memos) {
      if (memo.rolloverFromId == null && memo.rolloverToId == null) continue;
      await client.query('UPDATE memos SET rollover_from_id = $2, rollover_to_id = $3 WHERE id = $1',
        [idMap.get(String(memo.id)), idMap.get(String(memo.rolloverFromId)) || null, idMap.get(String(memo.rolloverToId)) || null]);
    }
    let summaryCount = 0;
    for (const summary of backup.summaries) {
      const ownerId = resolveOwner(summary);
      const result = await client.query(`INSERT INTO weekly_summaries(owner_id, week_start, goals, deliverables, actual, risks, updated_at)
        VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,NOW())) ON CONFLICT(owner_id,week_start) DO NOTHING RETURNING owner_id`,
      [ownerId, summary.weekStart, summary.goals, summary.deliverables, summary.actual, summary.risks, summary.updatedAt]);
      if (result.rowCount) { summaryCount++; continue; }
      const existing = (await client.query('SELECT goals,deliverables,actual,risks FROM weekly_summaries WHERE owner_id=$1 AND week_start=$2', [ownerId, summary.weekStart])).rows[0];
      if (['goals', 'deliverables', 'actual', 'risks'].some((key) => existing[key] !== summary[key])) fail(`${summary.ownerUsername} 的 ${summary.weekStart} 周总结已有不同内容，导入已撤销，未覆盖现有数据`, 409);
    }
    await client.query('INSERT INTO memo_backup_imports(backup_id,fingerprint,imported_ids,imported_by) VALUES($1,$2,$3::jsonb,$4)',
      [backup.backupId, backup.fingerprint, JSON.stringify([...idMap.values()]), importedBy]);
    await client.query('COMMIT');
    return { ok: true, reused: false, count: idMap.size, summaryCount,
      warnings: backup.modern ? [] : ['旧版备份未记录的交付和审核字段按旧数据恢复；建议重新导出新版备份。'] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
