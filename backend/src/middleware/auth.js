import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';

export async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      return res.status(401).json({ message: '未登录' });
    }

    const payload = jwt.verify(token, config.jwtSecret);
    const result = await query(
      `
      SELECT users.id, users.username, users.display_name AS "displayName", users.role,
             users.job_title AS "jobTitle", users.department_id AS "departmentId", departments.name AS "departmentName"
      FROM users
      JOIN departments ON departments.id = users.department_id
      WHERE users.id = $1
      `,
      [payload.userId]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: '登录状态已失效' });
    }

    req.user = result.rows[0];
    return next();
  } catch (error) {
    return res.status(401).json({ message: '登录状态无效' });
  }
}

export function canAccessUser(currentUser, targetUserId, targetDepartmentId = null) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (Number(targetUserId) === Number(currentUser.id)) return true;
  if (targetDepartmentId !== null && Number(targetDepartmentId) === Number(currentUser.departmentId)) return true;
  return false;
}

export function canViewMemo(currentUser, memoOwnerId, memoDepartmentId = null) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (Number(memoOwnerId) === Number(currentUser.id)) return true;
  if (memoDepartmentId !== null && Number(memoDepartmentId) === Number(currentUser.departmentId)) return true;
  // All authenticated team members can view shared calendar tasks
  return true;
}

export function canEditMemo(currentUser, memoOwnerId) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  return Number(memoOwnerId) === Number(currentUser.id);
}