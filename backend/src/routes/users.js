import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

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

usersRouter.get('/', authRequired, async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const result = await query(
    `
    SELECT users.id, users.username, users.display_name AS "displayName", users.role,
           users.job_title AS "jobTitle", users.department_id AS "departmentId", departments.name AS "departmentName"
    FROM users
    JOIN departments ON departments.id = users.department_id
    ORDER BY users.role, users.display_name
    `
  );

  return res.json({ users: result.rows });
});

usersRouter.patch('/:id', authRequired, async (req, res) => {
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

  return res.json({ ok: true });
});

usersRouter.delete('/:id', authRequired, async (req, res) => {
  if (!canManageUsers(req.user)) {
    return res.status(403).json({ message: '没有人员管理权限' });
  }

  const targetId = Number(req.params.id);
  if (!targetId || targetId === Number(req.user.id)) {
    return res.status(400).json({ message: '不能删除当前登录账号' });
  }

  const result = await query(
    `
    SELECT id, username, role, department_id AS "departmentId"
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

  await query('DELETE FROM users WHERE id = $1', [targetId]);
  return res.json({ ok: true });
});