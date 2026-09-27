import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDatabase } from './db/schema.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { memosRouter } from './routes/memos.js';
import { exportsRouter } from './routes/exports.js';
import { opsRouter } from './routes/ops.js';

const app = express();

app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/memos', memosRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/ops', opsRouter);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: '服务器内部错误' });
});

await initDatabase();

app.listen(config.port, () => {
  console.log(`智能工作日历后端已启动: ${config.port}`);
});