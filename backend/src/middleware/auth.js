import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';

const AUTH_CACHE_TTL_MS = 15_000;
const AUTH_CACHE_MAX_SIZE = 500;
const userAuthCache = new Map();

export function invalidateUserAuthCache(userId = null) {
  if (userId == null) {
    userAuthCache.clear();
    return;
  }
  userAuthCache.delete(Number(userId));
}

function getCachedUser(userId) {
  const key = Number(userId);
  const entry = userAuthCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userAuthCache.delete(key);
    return null;
  }
  return { ...entry.user };
}

function setCachedUser(user) {
  if (!user?.id) return;
  if (userAuthCache.size >= AUTH_CACHE_MAX_SIZE) {
    const oldestKey = userAuthCache.keys().next().value;
    if (oldestKey !== undefined) userAuthCache.delete(oldestKey);
  }
  userAuthCache.set(Number(user.id), {
    user: { ...user },
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS
  });
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: '未登录' });
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ message: '登录状态无效' });
  }

  try {
    const cached = getCachedUser(payload.userId);
    if (cached) {
      req.user = cached;
      return next();
    }

    const result = await query(
      `
      SELECT users.id, users.username, users.display_name AS "displayName", users.role,
             users.job_title AS "jobTitle", users.department_id AS "departmentId", departments.name AS "departmentName",
             users.avatar_key AS "avatarKey"
      FROM users
      JOIN departments ON departments.id = users.department_id
      WHERE users.id = $1
      `,
      [payload.userId]
    );

    if (result.rowCount === 0) {
      invalidateUserAuthCache(payload.userId);
      return res.status(401).json({ message: '登录状态已失效' });
    }

    const user = result.rows[0];
    setCachedUser(user);
    req.user = { ...user };
    return next();
  } catch (error) {
    return next(error);
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
