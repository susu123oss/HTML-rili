import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';

export const authRouter = express.Router();

const jobTitles = [
  '结构工程师',
  '助理结构工程师',
  '电气工程师',
  '助理电气工程师',
  '测试工程师',
  '技术员',
  '储备干部'
];

const toPublicUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  jobTitle: user.jobTitle,
  departmentId: user.departmentId,
  departmentName: user.departmentName
});

authRouter.post('/register', async (req, res) => {
  const { username, password, displayName, jobTitle } = req.body || {};
  const cleanDisplayName = String(displayName || username || '').trim();
  const cleanUsername = cleanDisplayName;
  const cleanJobTitle = String(jobTitle || '').trim();

  if (!cleanDisplayName || !password || !cleanJobTitle) {
    return res.status(400).json({ message: '请完整填写真实姓名、密码和岗位' });
  }

  if (!jobTitles.includes(cleanJobTitle)) {
    return res.status(400).json({ message: '请选择有效岗位' });
  }

  if (cleanUsername.length < 2 || cleanUsername.length > 32) {
    return res.status(400).json({ message: '真实姓名长度应为 2-32 位' });
  }

  if (String(password).length < 4) {
    return res.status(400).json({ message: '密码至少需要 4 位' });
  }

  const exists = await query('SELECT id FROM users WHERE username = $1', [cleanUsername]);
  if (exists.rowCount > 0) {
    return res.status(409).json({ message: '该姓名已注册' });
  }

  await query(
    `INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,
    ['研发部']
  );

  const passwordHash = await bcrypt.hash(String(password), 10);
  const systemRole = 'staff';
  const result = await query(
    `
    INSERT INTO users(username, password_hash, display_name, role, job_title, department_id)
    SELECT $1, $2, $3, $4, $5, departments.id
    FROM departments
    WHERE departments.name = $6
    RETURNING id, username, display_name AS "displayName", role, job_title AS "jobTitle",
              department_id AS "departmentId"
    `,
    [cleanUsername, passwordHash, cleanDisplayName, systemRole, cleanJobTitle, '研发部']
  );

  const user = { ...result.rows[0], departmentName: '研发部' };
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });
  return res.status(201).json({ token, user: toPublicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: '请输入用户名和密码' });
  }

  const result = await query(
    `
    SELECT users.id, users.username, users.password_hash AS "passwordHash",
           users.display_name AS "displayName", users.role, users.job_title AS "jobTitle",
           users.department_id AS "departmentId", departments.name AS "departmentName"
    FROM users
    JOIN departments ON departments.id = users.department_id
    WHERE users.username = $1
    `,
    [username]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.passwordHash);

  if (!ok) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });
  return res.json({ token, user: toPublicUser(user) });
});

authRouter.post('/change-password', async (req, res) => {
  const { username, oldPassword, newPassword } = req.body || {};
  const cleanUsername = String(username || '').trim();

  if (!cleanUsername || !oldPassword || !newPassword) {
    return res.status(400).json({ message: '请填写用户名、原密码和新密码' });
  }

  if (String(newPassword).length < 4) {
    return res.status(400).json({ message: '新密码至少需要 4 位' });
  }

  const result = await query(
    `
    SELECT id, password_hash AS "passwordHash"
    FROM users
    WHERE username = $1
    `,
    [cleanUsername]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({ message: '用户名或原密码错误' });
  }

  const user = result.rows[0];
  const ok = await bcrypt.compare(String(oldPassword), user.passwordHash);
  if (!ok) {
    return res.status(401).json({ message: '用户名或原密码错误' });
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, passwordHash]);
  return res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => {
  return res.json({ user: toPublicUser(req.user) });
});