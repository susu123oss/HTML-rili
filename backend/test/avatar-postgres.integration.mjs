// Real routes and SQL in a fresh isolated schema; production user/task tables are untouched.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import sharp from 'sharp';

if (!process.env.DATABASE_URL || !process.env.UPLOAD_DIR || !process.env.UPLOAD_DISK_PROBE) throw new Error('Explicit database and data-disk storage settings required');
const schema = 'avatar_accept_' + randomUUID().replaceAll('-', '');
const control = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=public' });
const keys = new Set();
let pool, store, server;
try {
  const [uploads, probe, container] = await Promise.all([stat(process.env.UPLOAD_DIR), stat(process.env.UPLOAD_DISK_PROBE), stat('/')]);
  assert.equal(uploads.dev, probe.dev); assert.notEqual(uploads.dev, container.dev);
  await control.query(`CREATE SCHEMA ${schema}`);
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  const db = await import('../src/db/pool.js'); pool = db.pool;
  assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
  const { initDatabase } = await import('../src/db/schema.js'); await initDatabase();
  const { authRouter } = await import('../src/routes/auth.js');
  const { usersRouter } = await import('../src/routes/users.js');
  const { avatarsRouter, profileAvatarRouter } = await import('../src/routes/avatars.js');
  store = (await import('../src/services/file-storage.js')).fileStorage;
  const app = express(); app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', authRouter); app.use('/api/users/me/avatar', profileAvatarRouter);
  app.use('/api/avatars', avatarsRouter); app.use('/api/users', usersRouter);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function json(url, options = {}, expected = 200) {
    const response = await fetch(base + url, options); const data = await response.json();
    assert.equal(response.status, expected, data.message || 'Unexpected response status');
    return data;
  }
  const headers = token => ({ Authorization: 'Bearer ' + token });
  const password = randomUUID();
  const first = await json('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: '头像隔离验收甲', password, jobTitle: '结构工程师' }) }, 201);
  const second = await json('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: '头像隔离验收乙', password, jobTitle: '测试工程师' }) }, 201);
  const admin = await json('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '0000' }) });
  const png = await sharp({ create: { width: 300, height: 500, channels: 3, background: '#36a4b3' } }).png().toBuffer();
  async function upload(token, bytes = png, type = 'image/png', expected = 200) {
    const form = new FormData(); form.append('avatar', new Blob([bytes], { type }), '../avatar.png');
    const data = await json('/api/users/me/avatar', { method: 'POST', headers: headers(token), body: form }, expected);
    if (data.user?.avatarUrl) keys.add(data.user.avatarUrl.split('/').at(-1));
    return data;
  }
  const uploaded = await upload(first.token), oldKey = uploaded.user.avatarUrl.split('/').at(-1);
  assert.equal((await pool.query('SELECT avatar_key FROM users WHERE id=$1', [second.user.id])).rows[0].avatar_key, '');
  assert.equal((await stat(store.resourcePath('avatars', oldKey))).dev, uploads.dev);
  const relogged = await json('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: first.user.username, password }) });
  assert.equal(relogged.user.avatarUrl, uploaded.user.avatarUrl);
  assert.equal((await json('/api/auth/me', { headers: headers(first.token) })).user.avatarUrl, uploaded.user.avatarUrl);
  const team = await json('/api/users', { headers: headers(admin.token) });
  assert.equal(team.users.find(user => user.id === first.user.id).avatarUrl, uploaded.user.avatarUrl);
  assert.equal((await fetch(base + uploaded.user.avatarUrl)).status, 401);
  const imageResponse = await fetch(base + uploaded.user.avatarUrl, { headers: headers(second.token) });
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get('content-type'), 'image/webp');
  const metadata = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.exif, undefined);
  await upload(first.token, Buffer.from('not a PNG'), 'image/png', 400);
  assert.equal((await json('/api/auth/me', { headers: headers(first.token) })).user.avatarUrl, uploaded.user.avatarUrl);
  const replaced = await Promise.all([upload(first.token), upload(first.token)]);
  const currentKey = (await pool.query('SELECT avatar_key FROM users WHERE id=$1', [first.user.id])).rows[0].avatar_key;
  assert(replaced.some(result => result.user.avatarUrl.endsWith(currentKey)));
  for (const key of keys) if (key !== currentKey) await assert.rejects(stat(store.resourcePath('avatars', key)), { code: 'ENOENT' });
  assert.equal((await fetch(base + '/api/avatars/' + oldKey, { headers: headers(first.token) })).status, 404);
  const reset = await json('/api/users/me/avatar', { method: 'DELETE', headers: headers(first.token) });
  assert.equal(reset.user.avatarUrl, ''); await assert.rejects(stat(store.resourcePath('avatars', currentKey)), { code: 'ENOENT' });
  const accountAvatar = await upload(second.token), accountKey = accountAvatar.user.avatarUrl.split('/').at(-1);
  await json('/api/users/' + second.user.id, { method: 'DELETE', headers: headers(admin.token) });
  await assert.rejects(stat(store.resourcePath('avatars', accountKey)), { code: 'ENOENT' });
  console.log('PASS: real PostgreSQL migration, ordinary-staff multipart upload, actual data-disk file, login/me/team persistence, private reads, WebP processing, invalid-file retention, concurrent replacement, old-file cleanup, reset and account-deletion cleanup.');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (store) for (const key of keys) await store.remove('avatars', key).catch(() => {});
  if (pool) await pool.end();
  assert(/^avatar_accept_[0-9a-f]{32}$/.test(schema));
  await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end();
}
