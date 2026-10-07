import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { parseReportWeek, buildWeeklyReport } from '../src/services/weekly-report.js';

const source = fs.readFileSync(new URL('../src/routes/memos.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export const memosRouter', 'const memosRouter');
const initialMemo = () => ({id:1,ownerId:2,departmentId:1,title:'Design',date:'2026-09-30',dueTime:'2026-09-30T10:00:00Z',completed:false,expectedDeliverable:'BOM V1',actualDeliverable:'',deliveryStatus:'in_progress',reviewComment:'',isReviewed:false,isLiked:false});
async function invoke(method, path, body, initial = initialMemo(), role = 'staff') {
  const routes = {}, notifications = []; let memo = {...initial};
  const router = {};
  for (const m of ['get','post','patch','put','delete']) router[m] = (p,...h) => { routes[m+' '+p] = h.at(-1); };
  const query = async (sql, p = []) => {
    if (/INSERT INTO memos/.test(sql)) {
      memo = {...memo,completed:p[5],expectedDeliverable:p[8],actualDeliverable:p[9],deliveryStatus:p[10]};
      return {rows:[{id:1}],rowCount:1};
    }
    if (/UPDATE memos/.test(sql)) {
      if (/expected_deliverable = \$10/.test(sql)) memo = {...memo,completed:p[5],expectedDeliverable:p[9],actualDeliverable:p[10],deliveryStatus:p[11],reviewComment:p[12]};
      else if (/delivery_status = 'returned'/.test(sql)) memo = {...memo,completed:false,deliveryStatus:'returned',reviewComment:p[0]};
      return {rows:[],rowCount:1};
    }
    if (/INSERT INTO notifications/.test(sql)) { notifications.push(p); return {rows:[],rowCount:1}; }
    if (/FROM users WHERE role/.test(sql)) return {rows:[{id:3}],rowCount:1};
    if (/FROM users WHERE id/.test(sql)) return {rows:[{id:2,departmentId:1}],rowCount:1};
    return {rows:[memo],rowCount:1};
  };
  const ctx = {express:{Router:()=>router},query,pool:{},authRequired:()=>{},canEditMemo:(u,id)=>u.role==='admin'||u.id===id,canAccessUser:()=>true,canViewMemo:()=>true,createHash};
  vm.createContext(ctx); vm.runInContext(source,ctx);
  let status = 200; const res = {status(n){status=n;return this;},json(x){this.body=x;return this;}};
  await routes[method+' '+path]({params:{id:'1'},body,user:{id:role==='admin'?3:2,role,displayName:role}},res,e=>{throw e;});
  return {status,memo,notifications};
}

test('new staff submission persists status and sends notification',async()=>{
  const r=await invoke('post','/',{date:'2026-09-30',title:'Design',expectedDeliverable:'BOM V1',actualDeliverable:'已经邮件交付审核',completed:false,deliveryStatus:'submitted'});
  assert.equal(r.status,201); assert.equal(r.memo.deliveryStatus,'submitted'); assert.equal(r.memo.completed,false); assert.equal(r.notifications.length,1);
});
test('staff cannot remove requirement, alter review or claim routine exemption',async()=>{
  for(const body of [{expectedDeliverable:'',completed:true},{reviewComment:'approved'},{actualDeliverable:'日常事务（无需交付物）',completed:true}]) {
    const r=await invoke('patch','/:id',body); assert.ok(r.status>=400); assert.equal(r.memo.completed,false); assert.equal(r.memo.expectedDeliverable,'BOM V1');
  }
});
test('unchanged confirmed evidence and returned evidence retain status on save',async()=>{
  const confirmed={...initialMemo(),actualDeliverable:'已经邮件交付审核',deliveryStatus:'confirmed',completed:true};
  let r=await invoke('patch','/:id',{title:'Revised',completed:true,actualDeliverable:confirmed.actualDeliverable,deliveryStatus:'confirmed'},confirmed);
  assert.equal(r.memo.completed,true); assert.equal(r.memo.deliveryStatus,'confirmed'); assert.equal(r.notifications.length,0);
  const returned={...confirmed,completed:false,deliveryStatus:'returned',reviewComment:'Fix dimensions'};
  r=await invoke('patch','/:id',{title:'Revised',completed:false,actualDeliverable:returned.actualDeliverable,deliveryStatus:'returned'},returned);
  assert.equal(r.memo.deliveryStatus,'returned'); assert.equal(r.notifications.length,0);
});
test('changed confirmed evidence requires review again',async()=>{
  const confirmed={...initialMemo(),actualDeliverable:'old',deliveryStatus:'confirmed',completed:true};
  const r=await invoke('patch','/:id',{actualDeliverable:'new',completed:true,deliveryStatus:'confirmed'},confirmed);
  assert.equal(r.memo.completed,false); assert.equal(r.memo.deliveryStatus,'submitted'); assert.equal(r.notifications.length,1);
});
test('return reason matches frontend property',async()=>{
  const r=await invoke('post','/:id/react',{action:'return-delivery',reviewComment:'Missing wiring dimensions'},initialMemo(),'admin');
  assert.equal(r.memo.reviewComment,'Missing wiring dimensions'); assert.ok(r.notifications[0][3].includes('Missing wiring dimensions'));
});
test('legacy completed record normal edit stays completed',async()=>{
  const legacy={...initialMemo(),expectedDeliverable:'',completed:true,deliveryStatus:'in_progress'};
  const r=await invoke('patch','/:id',{title:'Revised',completed:true,deliveryStatus:'confirmed'},legacy);
  assert.equal(r.memo.completed,true); assert.equal(r.memo.deliveryStatus,'confirmed');
});
test('staff frontend normal save preserves confirmed state',async()=>{
  const front=fs.readFileSync(new URL('../../frontend/app.js',import.meta.url),'utf8');
  const start=front.indexOf('async function saveMemo('); const tail=front.slice(start); const end=tail.slice(1).search(/\n(?:async )?function /);
  const memo={...initialMemo(),completed:true,actualDeliverable:'已经邮件交付审核',deliveryStatus:'confirmed'};
  const elements={memoTitle:{value:'Revised'},memoDueTime:{value:'2026-09-30T18:00'},memoDate:{value:'2026-09-30'},memoContent:{value:''},memoActualDeliverable:{value:memo.actualDeliverable},memoCompleted:{checked:true},memoWeeklyPlan:{checked:false},saveMemo:{textContent:'Save',disabled:false}};
  let payload; const ctx={state:{memos:[memo],selectedMemoId:1,selectedUserId:2,user:{id:2}},$:id=>elements[id]||null,isRoutineDeliverableChoice:v=>v==='日常事务（无需交付物）',canManageWorkspace:()=>false,window:{scrollX:0,scrollY:0},syncMemoCompletedState:()=>{},setOperationFeedback:()=>{},request:async(url,opts)=>{payload=JSON.parse(opts.body);throw Error('captured');}};
  vm.createContext(ctx);vm.runInContext(tail.slice(0,end+1),ctx);await ctx.saveMemo();
  assert.equal(payload.completed,true);assert.equal(payload.deliveryStatus,'confirmed');assert.equal(payload.expectedDeliverable,undefined);
});
test('export rejects invalid weeks and builds a genuine ZIP XLSX',()=>{
  assert.equal(parseReportWeek('2026-09-29'),null);assert.equal(parseReportWeek('2026-02-30'),null);
  assert.equal(parseReportWeek('2026-09-28')[14],'2026-10-12');
  assert.equal(parseReportWeek('2026-12-28')[7],'2027-01-04');
  const data=buildWeeklyReport({weekStart:'2026-09-28',users:[],memos:[],summaries:[]});
  assert.equal(data.readUInt32LE(0),0x04034b50);
});

test('weekly export rejects staff and invalid dates before reading team data',async()=>{
  const exportsSource=fs.readFileSync(new URL('../src/routes/exports.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export const exportsRouter','const exportsRouter');
  const routes={};let queries=0;
  const ctx={express:{Router:()=>({get:(p,...h)=>{routes[p]=h.at(-1);}})},authRequired:()=>{},parseReportWeek,buildWeeklyReport,query:async()=>{queries++;throw Error('must not query');}};
  vm.createContext(ctx);vm.runInContext(exportsSource,ctx);
  for(const [role,weekStart,expected] of [['staff','2026-09-28',403],['admin','2026-09-29',400],['admin','2026-02-30',400]]) {
    let status;const res={status(n){status=n;return this;},json(){return this;}};
    await routes['/weekly-report']({user:{role},query:{weekStart}},res,e=>{throw e;});assert.equal(status,expected);
  }
  assert.equal(queries,0);
});
