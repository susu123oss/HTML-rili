// Executes real SQL only in a newly created, isolated schema. No public table is touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

if (!process.env.CALENDAR_TEST_DATABASE_URL) throw new Error('Set CALENDAR_TEST_DATABASE_URL explicitly');
const root = process.env.CALENDAR_TEST_ROOT || new URL('../', import.meta.url).pathname;
const require = createRequire(process.env.CALENDAR_TEST_PACKAGE || new URL('../package.json', import.meta.url));
const { Pool } = require('pg');
const { exportMemoBackup, importMemoBackup } = await import(pathToFileURL(`${root}/src/services/memo-backup.js`));
const schema = `codex_loops_${process.pid}_${randomBytes(4).toString('hex')}`;
const control = new Pool({ connectionString: process.env.CALENDAR_TEST_DATABASE_URL });
let pool;
const checks = [];
function checked(label) { checks.push(label); console.log(`PASS ${label}`); }
try {
  await control.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({ connectionString: process.env.CALENDAR_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  assert.equal((await pool.query('SELECT current_schema() AS s')).rows[0].s, schema);
  const query = (sql, params) => pool.query(sql, params);
  const schemaSource = fs.readFileSync(`${root}/src/db/schema.js`, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
  const schemaCtx = { query, bcrypt: { hash: async () => 'isolated-test-hash' } };
  vm.createContext(schemaCtx); vm.runInContext(schemaSource, schemaCtx);
  await schemaCtx.initDatabase();
  await query('ALTER TABLE notifications DROP CONSTRAINT notifications_memo_id_fkey');
  await query('ALTER TABLE notifications ADD CONSTRAINT notifications_memo_id_fkey FOREIGN KEY(memo_id) REFERENCES memos(id) ON DELETE CASCADE');
  await schemaCtx.initDatabase();
  assert.equal((await query("SELECT confdeltype FROM pg_constraint WHERE conrelid='notifications'::regclass AND confrelid='memos'::regclass")).rows[0].confdeltype, 'n');
  checked('schema migration keeps deleted-task message history');

  const staff = (await query("INSERT INTO users(username,password_hash,display_name,role,department_id) SELECT 'test-staff','test','测试工程师','staff',id FROM departments LIMIT 1 RETURNING *")).rows[0];
  const other = (await query("INSERT INTO users(username,password_hash,display_name,role,department_id) SELECT 'test-other','test','另一个工程师','staff',id FROM departments LIMIT 1 RETURNING *")).rows[0];
  const admin = (await query("SELECT * FROM users WHERE username='admin'")).rows[0];
  const routes = {};
  const router = {};
  for (const method of ['get','post','patch','put','delete']) router[method] = (path, ...handlers) => { routes[`${method} ${path}`] = handlers.at(-1); };
  const ctx = { pool, query, createHash, express: { Router: () => router }, authRequired: () => {},
    canEditMemo: (user, owner) => user.role === 'admin' || Number(user.id) === Number(owner), canAccessUser: () => true, canViewMemo: () => true };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(`${root}/src/routes/memos.js`, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export const memosRouter', 'const memosRouter'), ctx);
  async function invoke(method, path, user, body = {}, id = 1, params = {}) {
    let status = 200, output;
    const res = { status(value) { status = value; return this; }, json(value) { output = value; return this; }, setHeader() {}, end() {} };
    await routes[`${method} ${path}`]({ user, body, params: { id: String(id) }, query: params, get: () => '' }, res, (error) => { throw error; });
    return { status, body: output };
  }
  async function fixture(overrides = {}) {
    const m = { owner: staff.id, title: '测试任务', content: '', actual: '', expected: '', status: 'in_progress', kind: 'memo', ...overrides };
    return (await query(`INSERT INTO memos(owner_id,date,title,content,actual_deliverable,expected_deliverable,delivery_status,plan_kind,due_time,review_comment)
      VALUES($1,'2026-09-30',$2,$3,$4,$5,$6,$7,'2026-09-30T10:00:00Z',$8) RETURNING id`, [m.owner,m.title,m.content,m.actual,m.expected,m.status,m.kind,m.comment || ''])).rows[0].id;
  }
  const empty = await fixture();
  const routine = await fixture({ actual: '日常事务（无需交付物）' });
  const submitted = await fixture({ actual: '已经邮件交付审核', status: 'submitted', expected: 'BOM V1' });
  const returned = await fixture({ actual: '已经邮件交付审核', status: 'returned', expected: 'BOM V1' });
  const foreign = await fixture({ owner: other.id, actual: '日常事务（无需交付物）' });
  let result = await invoke('post','/batch-complete',staff,{memoIds:[empty,routine,submitted,returned,foreign,routine]});
  assert.equal(result.body.count,1); assert.deepEqual(Array.from(result.body.updatedIds),[routine]);
  assert.equal((await query('SELECT completed FROM memos WHERE id=$1',[submitted])).rows[0].completed,false);
  checked('staff batch cannot bypass deliverable review or ownership');
  result = await invoke('post','/batch-complete',admin,{memoIds:[submitted,empty]});
  assert.equal(result.body.count,1);
  assert.equal((await query('SELECT delivery_status FROM memos WHERE id=$1',[submitted])).rows[0].delivery_status,'confirmed');
  assert.equal((await query("SELECT count(*)::int AS n FROM notifications WHERE memo_id=$1 AND type='confirm'",[submitted])).rows[0].n,1);
  assert.equal((await invoke('post','/:id/react',admin,{action:'confirm-delivery'},empty)).status,400);
  checked('admin completion requires evidence and notifies the owner');

  const fullContent = '# 完整正文\n' + '长内容不应被320字摘要替代\n'.repeat(120);
  const original = await fixture({ content: fullContent, actual: '已经邮件交付审核', status: 'returned', comment: '补充尺寸' });
  const concurrent = await Promise.all([1,2].map(() => invoke('post','/:id/rollover',staff,{targetDate:'2026-10-01',reason:'次日结转'},original)));
  assert.deepEqual(concurrent.map((r) => r.status).sort(),[201,409]);
  const successor = concurrent.find((r) => r.status===201).body.memo;
  assert.equal(successor.content,fullContent); assert.equal(successor.planKind,'memo');
  assert.equal(successor.deliveryStatus,'returned'); assert.equal(successor.actualDeliverable,'已经邮件交付审核'); assert.equal(successor.reviewComment,'补充尺寸');
  assert.equal((await invoke('post','/:id/react',admin,{action:'confirm-delivery'},original)).status,409);
  const pending = await fixture({ actual:'已经邮件交付审核', status:'submitted' });
  assert.equal((await invoke('post','/:id/rollover',staff,{targetDate:'2026-10-05'},pending)).status,409);
  const plan = await fixture({kind:'plan'});
  const planSuccessor = (await invoke('post','/:id/rollover',staff,{targetDate:'2026-10-05'},plan)).body.memo;
  assert.equal((await invoke('patch','/:id',staff,{planKind:'memo'},planSuccessor.id)).status,409);
  checked('daily and weekly carryover preserve full evidence, prevent duplicate and pending-review rollover');

  await query("INSERT INTO weekly_summaries(owner_id,week_start,goals,deliverables,actual,risks) VALUES($1,'2026-09-28','目标','成果','复盘','风险')",[staff.id]);
  await query('UPDATE memos SET is_reviewed=TRUE,is_liked=TRUE WHERE id=$1',[original]);
  const backup = JSON.parse(JSON.stringify(await exportMemoBackup(pool,[successor.id],'test-staff')));
  assert.equal(backup.memos.length,2); assert.equal(backup.memos[0].content,fullContent); assert.equal(backup.weeklySummaries.length,1);
  for (const memo of backup.memos) memo.ownerId = 98765;
  const imported = await importMemoBackup(pool,backup,admin.id);
  assert.equal(imported.count,2); assert.equal(imported.reused,false);
  const ids = (await query('SELECT imported_ids FROM memo_backup_imports WHERE backup_id=$1',[backup.backupId])).rows[0].imported_ids;
  const copies = (await query('SELECT * FROM memos WHERE id=ANY($1::int[]) ORDER BY id',[ids])).rows;
  assert.equal(copies[0].owner_id,staff.id); assert.equal(copies[0].content,fullContent);
  assert.equal(copies[0].rollover_to_id,copies[1].id); assert.equal(copies[1].rollover_from_id,copies[0].id);
  assert.equal(copies[0].is_reviewed,true); assert.equal(copies[0].is_liked,true); assert.equal(copies[1].review_comment,'补充尺寸');
  const countBefore = (await query('SELECT count(*)::int AS n FROM memos')).rows[0].n;
  const repeats = await Promise.all([1,2].map(() => importMemoBackup(pool,JSON.parse(JSON.stringify(backup)),admin.id)));
  assert(repeats.every((item) => item.reused));
  assert.equal((await query('SELECT count(*)::int AS n FROM memos')).rows[0].n,countBefore);
  checked('backup round trip retains full content, ownership, review, linkage and summaries; retries are idempotent');
  const broken = JSON.parse(JSON.stringify(backup)); broken.backupId='unknown-user-test'; broken.memos[1].ownerUsername='missing'; broken.memos[0].ownerUsername='missing';
  await assert.rejects(importMemoBackup(pool,broken,admin.id),/无法匹配/);
  const conflict = JSON.parse(JSON.stringify(backup)); conflict.backupId='summary-conflict-test'; conflict.weeklySummaries[0].goals='覆盖现有目标';
  await assert.rejects(importMemoBackup(pool,conflict,admin.id),/已有不同内容/);
  assert.equal((await query('SELECT count(*)::int AS n FROM memos')).rows[0].n,countBefore);
  const truncated = { memos:[{id:1,ownerId:staff.id,title:'旧摘要',date:'2026-09-30',contentPreview:'摘要'}] };
  await assert.rejects(importMemoBackup(pool,truncated,admin.id),/未包含完整正文/);
  checked('failed restore rolls back every memo and incomplete legacy backup is rejected');

  const noticeMemo = await fixture();
  await query("INSERT INTO notifications(user_id,memo_id,type,title,content) VALUES($1,$2,'urge','催办','删除后仍可查看')",[staff.id,noticeMemo]);
  await query('DELETE FROM memos WHERE id=$1',[noticeMemo]);
  const historyRoutes = {};
  const historyCtx = { query,authRequired:()=>{},express:{Router:()=>({get:(p,...h)=>historyRoutes[`get ${p}`]=h.at(-1),post:(p,...h)=>historyRoutes[`post ${p}`]=h.at(-1)})} };
  vm.createContext(historyCtx); vm.runInContext(fs.readFileSync(`${root}/src/routes/notifications.js`,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const notificationsRouter','const notificationsRouter'),historyCtx);
  let history; const res = {json(body){history=body;return this;},status(){return this;}};
  await historyRoutes['get /history']({user:staff,query:{}},res,e=>{throw e;});
  assert(history.notifications.some((n)=>n.content==='删除后仍可查看'&&n.memoId===null));
  await historyRoutes['get /history']({user:other,query:{}},res,e=>{throw e;});
  assert(!history.notifications.some((n)=>n.content==='删除后仍可查看'));
  checked('message history survives task deletion and remains scoped to its recipient');
  const otherNotice=(await query("INSERT INTO notifications(user_id,type,title,content) VALUES($1,'urge','其他账号消息','保持未读') RETURNING id",[other.id])).rows[0].id;
  const ownUrge=(await query("INSERT INTO notifications(user_id,memo_id,type,title,content) VALUES($1,$2,'urge','原任务催办','保留催办记录') RETURNING id",[staff.id,empty])).rows[0].id;
  const cutoff=ownUrge;
  const incoming=(await query("INSERT INTO notifications(user_id,type,title,content) VALUES($1,'urge','新到消息','清空时应保留') RETURNING id",[staff.id])).rows[0].id;
  let clearStatus=200,clearResult;
  const clearRes={status(n){clearStatus=n;return this;},json(body){clearResult=body;return this;}};
  await historyRoutes['post /clear']({user:staff,body:{throughId:0}},clearRes,e=>{throw e;});
  assert.equal(clearStatus,400);
  await historyRoutes['post /clear']({user:staff,body:{throughId:cutoff,userId:other.id}},clearRes,e=>{throw e;});
  assert(clearResult.count>=1);
  assert.equal((await query('SELECT cleared_at FROM notifications WHERE id=$1',[otherNotice])).rows[0].cleared_at,null);
  assert.equal((await query('SELECT cleared_at FROM notifications WHERE id=$1',[incoming])).rows[0].cleared_at,null);
  const urgeSource=(await query('SELECT cleared_at,is_read,memo_id FROM notifications WHERE id=$1',[ownUrge])).rows[0];
  assert(urgeSource.cleared_at);assert.equal(urgeSource.is_read,true);assert.equal(urgeSource.memo_id,empty);
  await historyRoutes['get /history']({user:staff,query:{}},res,e=>{throw e;});
  assert.deepEqual(Array.from(history.notifications.map(n=>n.id)),[incoming]);
  await historyRoutes['get /']({user:staff},res,e=>{throw e;});
  assert.deepEqual(Array.from(history.notifications.map(n=>n.id)),[incoming]);
  await historyRoutes['post /clear']({user:staff,body:{throughId:cutoff}},clearRes,e=>{throw e;});
  assert.equal(clearResult.count,0);
  checked('clear is recipient-scoped and persistent, hides old read/unread messages, preserves incoming messages and task urge source records');
  console.log(`Verified ${checks.length} business groups in isolated PostgreSQL schema`);
} finally {
  if (pool) await pool.end();
  await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await control.end();
  console.log('Temporary test schema removed');
}
