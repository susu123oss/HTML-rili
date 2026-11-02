import express from 'express';
import cors from 'cors';
import { patchExpressAsync } from './middleware/async-handler.js';
import { config } from './config.js';
import { initDatabase } from './db/schema.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { memosRouter } from './routes/memos.js';
import { exportsRouter } from './routes/exports.js';
import { opsRouter } from './routes/ops.js';
import { notificationsRouter } from './routes/notifications.js';
import { backupsRouter } from './routes/backups.js';
import { avatarsRouter, profileAvatarRouter } from './routes/avatars.js';

patchExpressAsync();

process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[process] Uncaught Exception:', error);
});

const app = express();

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use('/api/backups', express.json({ limit: '20mb' }), backupsRouter);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/users/me/avatar', profileAvatarRouter);
app.use('/api/avatars', avatarsRouter);
app.use('/api/users', usersRouter);
app.use('/api/memos', memosRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/ops', opsRouter);
app.use('/api/notifications', notificationsRouter);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: '请求数据格式不正确' });
  }
  if (error?.code === '23505') {
    return res.status(409).json({ message: '数据已存在，请勿重复提交' });
  }
  console.error(`[api-error] ${req.method} ${req.originalUrl}:`, error);
  return res.status(error?.status || 500).json({ message: error?.status ? error.message : '服务器内部错误' });
});

await initDatabase();

app.listen(config.port, () => {
  console.log(`智能工作日历后端已启动: ${config.port}`);
});
