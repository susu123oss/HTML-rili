// Real API and concurrent PostgreSQL writes, restricted to a fresh disposable schema.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';

if (!process.env.DATABASE_URL) throw new Error('Explicit DATABASE_URL required');
const schema = 'editor_accept_' + randomUUID().replaceAll('-', '');
const control = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: '-c search_path=public' });
let pool, server;
try {
  await control.query(`CREATE SCHEMA ${schema}`);
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  ({ pool } = await import('../src/db/pool.js'));
  assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
  const { initDatabase } = await import('../src/db/schema.js');
  await initDatabase();
  const { authRouter } = await import('../src/routes/auth.js');
  const { memosRouter } = await import('../src/routes/memos.js');
  const app = express(); app.use(express.json());
  app.use('/api/auth', authRouter); app.use('/api/memos', memosRouter);
  app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let token = '';
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + '/api' + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  const login = await api('/auth/login', 'POST', { username: 'admin', password: '0000' });
  assert.equal(login.status, 200); token = login.data.token;
  const created = await api('/memos', 'POST', { date: '2026-10-08', title: '隔离事项', content: 'original',
    color: '#4361ee', completed: false, dueTime: '2026-10-08T18:00:00+08:00', actualDeliverable: '日常事务（无需交付物）' });
  assert.equal(created.status, 201, created.data.message);
  const id = created.data.memo.id;
  const detail = await api(`/memos/${id}`);
  assert(detail.data.memo.revision);
  const revision = detail.data.memo.revision;
  const changes = await Promise.all(['first', 'second'].map(content =>
    api(`/memos/${id}`, 'PATCH', { content, expectedRevision: revision })));
  assert.deepEqual(changes.map(r => r.status).sort(), [200, 409]);
  assert.equal(changes.find(r => r.status === 409).data.code, 'EDITOR_VERSION_CONFLICT');
  const winner = changes.find(r => r.status === 200).data.memo;
  assert.notEqual(winner.revision, revision);
  assert.equal((await api(`/memos/${id}`)).data.memo.content, winner.content);
  const stale = await api(`/memos/${id}`, 'PATCH', { content: 'must not overwrite', expectedRevision: revision });
  assert.equal(stale.status, 409);
  assert.equal((await api(`/memos/${id}`)).data.memo.content, winner.content);
  assert.equal((await api(`/memos/${id}`, 'PATCH', { content: 'legacy partial update' })).status, 200);

  const ownerId = login.data.user.id;
  const week = '/memos/weekly-summaries/2026-10-05';
  const firstSummaries = await Promise.all(['first', 'second'].map(goals =>
    api(week, 'PUT', { ownerId, goals, expectedRevision: 'new' })));
  assert.deepEqual(firstSummaries.map(r => r.status).sort(), [200, 409]);
  const firstSummary = firstSummaries.find(r => r.status === 200).data.summary;
  assert(firstSummary.revision);
  const nextSummaries = await Promise.all(['third', 'fourth'].map(goals =>
    api(week, 'PUT', { ownerId, goals, expectedRevision: firstSummary.revision })));
  assert.deepEqual(nextSummaries.map(r => r.status).sort(), [200, 409]);
  const finalSummary = nextSummaries.find(r => r.status === 200).data.summary;
  const summaries = await api(`/memos/weekly-summaries?startWeek=2026-10-05&weeks=1&userId=${ownerId}`);
  assert.equal(summaries.data.summaries[0].goals, finalSummary.goals);
  await pool.query('DELETE FROM weekly_summaries WHERE owner_id=$1', [ownerId]);
  assert.equal((await api(week, 'PUT', { ownerId, goals: 'cannot recreate deleted revision', expectedRevision: finalSummary.revision })).status, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM weekly_summaries')).rows[0].n, 0);
  assert.equal((await api(week, 'PUT', { ownerId, goals: 'legacy summary' })).status, 200);
  assert.equal((await api(week, 'PUT', { ownerId, expectedRevision: {} })).status, 400);
  assert.equal((await api(`/memos/${id}`, 'PATCH', { expectedRevision: {} })).status, 400);
  console.log('PASS: real isolated PostgreSQL API, concurrent memo PATCH and weekly create/update reject stale versions, no overwritten winner, deleted version cannot recreate, legacy partial updates compatible, malformed versions rejected.');
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (pool) await pool.end();
  assert(/^editor_accept_[0-9a-f]{32}$/.test(schema));
  await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await control.end();
}
