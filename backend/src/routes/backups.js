import express from 'express';
import { pool } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { exportMemoBackup, importMemoBackup } from '../services/memo-backup.js';

export const backupsRouter = express.Router();
backupsRouter.use(authRequired, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: '只有管理员可以备份或恢复数据' });
  next();
});
backupsRouter.post('/export', async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const backup = await exportMemoBackup(client, req.body?.memoIds, req.body?.scope);
    await client.query('COMMIT');
    return res.json(backup);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return next(error);
  } finally { client?.release(); }
});
backupsRouter.post('/import', async (req, res, next) => {
  try { return res.json(await importMemoBackup(pool, req.body, req.user.id)); }
  catch (error) { return next(error); }
});
