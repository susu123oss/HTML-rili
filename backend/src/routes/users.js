import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { authRequired, invalidateUserAuthCache } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { toPublicUser } from '../services/user-profile.js';
import { removeUnreferencedAvatar } from '../services/avatar.js';

export const usersRouter = express.Router();

const canManageUsers = (user) => user.role === 'admin';
const editableRoles = new Set(['staff']);
const editableJobTitles = new Set([
  '结构工程师',
  '助理结构工程师',
  '电气工程师',
  '助理电气工程师',
  '测试工程师',
  '技术员',
  '储备干部'
]);

const normalizeText = (value) => String(value ?? '').trim();

usersRouter.get('/', authRequired, asyncHandler(async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const result = await query(
    `
    SELECT users.id, users.username, users.display_name AS "displayName", users.role,
           users.job_title AS "jobTitle", users.department_id AS "departmentId", departments.name AS "departmentName",
           users.avatar_key AS "avatarKey"
    FROM users
    JOIN departments ON departments.id = users.department_id
    ORDER BY users.role, users.display_name
    `
  );

  return res.json({ users: result.rows.map(toPublicUser) });
}));

usersRouter.post('/', authRequired, asyncHandler(async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const displayName = normalizeText(req.body?.displayName || req.body?.username);
  const jobTitle = normalizeText(req.body?.jobTitle);
  const departmentName = normalizeText(req.body?.departmentName) || '研发部';
  const rawPassword = String(req.body?.password ?? '').trim();

  if (!displayName || !jobTitle || !rawPassword) {
    return res.status(400).json({ message: '请完整填写成员姓名、岗位和初始密码' });
  }

  if (displayName.length < 2 || displayName.length > 32) {
    return res.status(400).json({ message: '成员姓名长度应为 2-32 位' });
  }

  if (!editableJobTitles.has(jobTitle)) {
    return res.status(400).json({ message: '请选择有效的岗位' });
  }

  if (rawPassword.length < 4) {
    return res.status(400).json({ message: '初始密码至少需要 4 位' });
  }

  const exists = await query('SELECT id FROM users WHERE username = $1', [displayName]);
  if (exists.rowCount > 0) {
    return res.status(409).json({ message: '该成员账号已存在' });
  }

  await query('INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [departmentName]);
  const passwordHash = await bcrypt.hash(rawPassword, 10);
  const result = await query(
    `
    INSERT INTO users(username, password_hash, display_name, role, job_title, department_id)
    SELECT $1, $2, $3, 'staff', $4, departments.id
    FROM departments
    WHERE departments.name = $5
    ON CONFLICT(username) DO NOTHING
    RETURNING id, username, display_name AS "displayName", role, job_title AS "jobTitle",
              department_id AS "departmentId", avatar_key AS "avatarKey"
    `,
    [displayName, passwordHash, displayName, jobTitle, departmentName]
  );

  if (result.rowCount === 0) {
    return res.status(409).json({ message: '该成员账号已存在' });
  }

  return res.status(201).json({
    user: toPublicUser({ ...result.rows[0], departmentName })
  });
}));

usersRouter.patch('/:id', authRequired, asyncHandler(async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const targetId = Number(req.params.id);
  if (!targetId) {
    return res.status(400).json({ message: '成员参数无效' });
  }

  const targetResult = await query(
    `
    SELECT users.id, users.username, users.role, users.job_title AS "jobTitle",
           users.department_id AS "departmentId", departments.name AS "departmentName"
    FROM users
    JOIN departments ON departments.id = users.department_id
    WHERE users.id = $1
    `,
    [targetId]
  );

  if (targetResult.rowCount === 0) {
    return res.status(404).json({ message: '成员不存在' });
  }

  const target = targetResult.rows[0];
  if (target.username === 'admin') {
    return res.status(400).json({ message: '系统管理员不支持在人员管理中修改' });
  }

  const jobTitle = normalizeText(req.body?.jobTitle || target.jobTitle);
  const role = normalizeText(req.body?.role || target.role);
  const departmentName = normalizeText(req.body?.departmentName || target.departmentName);
  const newPassword = normalizeText(req.body?.newPassword || '');

  if (!editableJobTitles.has(jobTitle)) {
    return res.status(400).json({ message: '岗位不在可选范围内' });
  }

  if (!editableRoles.has(role)) {
    return res.status(400).json({ message: '角色不在可选范围内' });
  }

  if (!departmentName) {
    return res.status(400).json({ message: '部门不能为空' });
  }

  if (req.user.role !== 'admin' && (role !== target.role || departmentName !== target.departmentName)) {
    return res.status(403).json({ message: '只有管理员可以修改角色和部门' });
  }

  if (newPassword && req.user.role !== 'admin') {
    return res.status(403).json({ message: '只有管理员可以修改成员密码' });
  }

  if (newPassword && newPassword.length < 4) {
    return res.status(400).json({ message: '新密码至少需要 4 位' });
  }

  await query('INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [departmentName]);
  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 10) : null;
  await query(
    `
    UPDATE users
    SET role = $2,
        job_title = $3,
        department_id = departments.id,
        password_hash = COALESCE($5, password_hash)
    FROM departments
    WHERE users.id = $1 AND departments.name = $4
    `,
    [targetId, role, jobTitle, departmentName, passwordHash]
  );

  invalidateUserAuthCache(targetId);
  return res.json({ ok: true });
}));

usersRouter.delete('/:id', authRequired, asyncHandler(async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const targetId = Number(req.params.id);
  if (!targetId || targetId === Number(req.user.id)) {
    return res.status(400).json({ message: '不能删除当前登录账号' });
  }

  const result = await query(
    `
    SELECT id, username, role, department_id AS "departmentId", avatar_key AS "avatarKey"
    FROM users
    WHERE id = $1
    `,
    [targetId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: '成员不存在' });
  }

  const target = result.rows[0];
  if (target.username === 'admin' || target.role === 'admin') {
    return res.status(400).json({ message: '不能删除系统管理员' });
  }

  await query(
    `UPDATE notifications
     SET is_read = TRUE
     WHERE is_read = FALSE
       AND memo_id IN (SELECT id FROM memos WHERE owner_id = $1)`,
    [targetId]
  );
  const deleted = await query('DELETE FROM users WHERE id = $1 RETURNING avatar_key AS "avatarKey"', [targetId]);
  invalidateUserAuthCache(targetId);
  await removeUnreferencedAvatar(deleted.rows[0]?.avatarKey);
  return res.json({ ok: true });
}));
