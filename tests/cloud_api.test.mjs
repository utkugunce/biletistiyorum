import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import admin, * as adminHelpers from '../api/admin.js';
import { runAdmin } from '../lib/admin-actions.js';
import request from '../api/request.js';
import track from '../api/my-requests.js';
import staff from '../api/staff.js';
import { tokenHash, DEFAULT_MATCH_ID, loadSystemState, saveSystemState } from '../lib/store.js';

process.env.SUPABASE_URL = 'https://database.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
process.env.ZEREN_COMPANION_TOKEN = 'test-only-companion-token-at-least-32-characters';
delete process.env.VERCEL;
const SESSION = 'test-only-session';
let clientSequence=0;
let state, rows, writes, unavailable, barrierReads, barrier, release;
const fixtureRow = (id, extra={}) => ({ id, person: 'Test Person', requested_count: 1,
  match_name: 'Zeren Spor - Kuzeyboru', target_block: '102', phone: '05321234567', assigned_seats: [], ...extra });
function reset() {
  clientSequence++;
  state = { version: 7, virtual_assignments: {}, sent_map: {}, sessions: { [tokenHash(SESSION)]: { expires_at: Date.now()+86400000 } } };
  rows = [fixtureRow('REQ-A'), fixtureRow('REQ-B', { person: 'Other Person' })];
  writes=0; unavailable=false; barrierReads=0; barrier=null;
}
function raceReads() { barrier = new Promise(resolve => { release=resolve; }); }
globalThis.fetch = async (url, options={}) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, 'database.test', 'Only the mocked database is allowed');
  const filter = parsed.searchParams.get('id'), method=options.method || 'GET';
  if (method === 'GET' && filter === 'eq.__SYSTEM_STATE__') {
    if (unavailable) return new Response('{}', {status:503});
    const snapshot=structuredClone(state);
    if (barrier && ++barrierReads <= 2) { if (barrierReads===2) release(); await barrier; }
    return Response.json([{assigned_seats:snapshot}]);
  }
  if (method === 'PATCH' && filter === 'eq.__SYSTEM_STATE__') {
    const expected=parsed.searchParams.get('assigned_seats->>version');
    const matches=expected==='is.null' ? state.version==null : expected===`eq.${state.version}`;
    if (!matches) return Response.json([]);
    state=JSON.parse(options.body).assigned_seats;writes++;
    return Response.json([{id:'__SYSTEM_STATE__'}]);
  }
  if (method==='GET') return Response.json(filter?.startsWith('eq.') ? rows.filter(r=>r.id===decodeURIComponent(filter.slice(3))) : rows);
  if (method==='POST') {
    const row=JSON.parse(options.body);
    if (!rows.some(r=>r.id===row.id)) rows.push(row);
    return Response.json([row]);
  }
  throw new Error('Unexpected mocked database operation');
};
function req(url, body={}, method='POST', authenticated=true, extra={}) {
  return {url,body,method,headers:{host:'app.test', ...(authenticated?{authorization:'Bearer '+SESSION}:{}), ...extra},socket:{remoteAddress:'192.0.2.'+clientSequence}};
}
function response() { return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;},end(){return this;},send(body){this.body=body;return this;}}; }
async function run(handler, request) { const res=response();await handler(request,res);return res; }
const assign=(id,seat)=>req('/api/excel/assign-request',{request_id:id,block_id:'102',seat_ids:[`3-${seat}`]});

test('different concurrent seats both survive database CAS retries',async()=>{
 reset();raceReads();const results=await Promise.all([run(admin,assign('REQ-A',1)),run(admin,assign('REQ-B',2))]);
 assert.deepEqual(results.map(r=>r.code),[200,200]);assert.equal(Object.keys(state.virtual_assignments).length,2);
});
test('same concurrent seat accepts exactly one request',async()=>{
 reset();raceReads();const results=await Promise.all([run(admin,assign('REQ-A',1)),run(admin,assign('REQ-B',1))]);
 assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);assert.equal(Object.keys(state.virtual_assignments).length,1);
});
test('failed cold read never writes an empty replacement',async()=>{
 reset();state.virtual_assignments['102:3-2']={group:'Previous',request_id:'REQ-B'};unavailable=true;
 const result=await run(admin,assign('REQ-A',1));assert.equal(result.code,503);assert.equal(writes,0);assert.ok(state.virtual_assignments['102:3-2']);
});
test('legacy snapshot without version is upgraded with an atomic null predicate',async()=>{
 reset();delete state.version;const loaded=await loadSystemState();loaded.sent_map['REQ-A']=true;await saveSystemState(loaded);assert.equal(state.version,1);
});
test('deleting old request leaves a reassigned seat owned by another request',async()=>{
 reset();rows[0].assigned_seats=['3-1'];state.virtual_assignments['102:3-1']={group:'Other Person',request_id:'REQ-B'};
 const result=await run(admin,req('/api/portal/request/REQ-A/delete'));assert.equal(result.code,200);assert.equal(state.virtual_assignments['102:3-1'].request_id,'REQ-B');assert.ok(state.deleted_requests['REQ-A']);
});
test('same person different requests cannot steal each other seats',async()=>{
 reset();rows[1].person=rows[0].person;await run(admin,assign('REQ-A',1));const result=await run(admin,assign('REQ-B',1));assert.equal(result.code,409);
});
test('dispatch center uses real request identifiers and one sent state',async()=>{
 reset();await run(admin,assign('REQ-A',1));const list=await run(admin,req('/api/dispatch/list',{},'GET'));
 assert.equal(list.body.recipients[0].id,'REQ-A');
 assert.equal((await run(admin,req('/api/dispatch/mark-sent',{request_id:'REQ-A',sent:true}))).code,200);
 state.tracking_access={'REQ-A':tokenHash('a'.repeat(64))};
 const tracking=await run(track,req('/api/portal/my-requests',{},'GET',false,{'x-tracking-token':'REQ-A.'+'a'.repeat(64)}));
 assert.equal(tracking.code,200);assert.equal(tracking.body[0].whatsapp_sent,true);
 const summary=await run(admin,req('/api/excel/summary',{},'GET'));assert.equal(summary.body.requests.find(r=>r.request_id==='REQ-A').whatsapp_sent,true);
});
test('anonymous known code or telephone cannot read tracking records',async()=>{
 reset();for(const query of ['REQ-A','05321234567']) {const res=await run(track,req('/api/portal/my-requests?q='+query,{},'GET',false));assert.equal(res.code,401);assert.ok(!Array.isArray(res.body));}
});
test('tracking key only reads its own request',async()=>{
 reset();state.tracking_access={'REQ-A':tokenHash('a'.repeat(64))};
 const result=await run(track,req('/api/portal/my-requests',{},'GET',false,{'x-tracking-token':'REQ-B.'+'a'.repeat(64)}));assert.equal(result.code,403);
});
test('request creation uses UUID, ignores supplied ID and is idempotent',async()=>{
 reset();const payload={id:'__SYSTEM_STATE__',person:'New Person',phone:'05321234567',requested_count:30,match_name:'Zeren Spor - Kuzeyboru',target_block:'102'};
 const headers={'idempotency-key':'x'.repeat(64)};
 const first=await run(request,req('/api/portal/request',payload,'POST',false,headers));
 const second=await run(request,req('/api/portal/request',payload,'POST',false,headers));
 assert.equal(first.code,200);assert.match(first.body.id,/^ZS-[0-9a-f-]{36}$/);assert.equal(first.body.id,second.body.id);assert.equal(rows.filter(r=>r.person==='New Person').length,1);assert.equal(first.body.requested_count,30);
 const tracked=await run(track,req('/api/portal/my-requests',{},'GET',false,{'x-tracking-token':first.body.tracking_token}));assert.equal(tracked.code,200);assert.equal(tracked.body.length,1);
});
test('invalid ticket counts and phone numbers are rejected before writing',async()=>{
 reset();for(const count of [0,101,2.5,'no']) {const res=await run(request,req('/api/portal/request',{person:'Test',phone:'05321234567',requested_count:count},'POST',false));assert.equal(res.code,400);}assert.equal(writes,0);
});
test('an idempotency key cannot be reused for a different payload',async()=>{
 reset();const payload={person:'Test',phone:'05321234567',requested_count:1,match_name:'Zeren Spor - Kuzeyboru'};const headers={'idempotency-key':'y'.repeat(64)};
 assert.equal((await run(request,req('/api/portal/request',payload,'POST',false,headers))).code,200);
 assert.equal((await run(request,req('/api/portal/request',{...payload,requested_count:2},'POST',false,headers))).code,409);
});
test('logout revokes copied bearer tokens on the server',async()=>{
 reset();assert.equal((await run(admin,req('/api/auth/logout'))).code,200);
 assert.equal((await run(admin,req('/api/auth/check',{},'GET'))).body.authenticated,false);
 assert.equal((await run(admin,req('/api/state',{},'GET'))).code,401);
});
test('expired sessions cannot authenticate',async()=>{
 reset();state.sessions[tokenHash(SESSION)].expires_at=Date.now()-1;assert.equal((await run(admin,req('/api/state',{},'GET'))).code,401);
});
test('login hashes legacy password and sets a secure HttpOnly cookie',async()=>{
 reset();state.admin_password='test-only-password';
 const res=await run(admin,req('/api/auth/login',{password:'test-only-password'},'POST',false,{'x-forwarded-proto':'https'}));
 assert.equal(res.code,200);assert.ok(!state.admin_password);assert.match(state.admin_password_hash,/^[0-9a-f]+:[0-9a-f]+$/);assert.ok(!res.body.token);assert.match(res.headers['Set-Cookie'],/HttpOnly.*Secure/);
});
test('password change revokes other sessions',async()=>{
 reset();state.admin_password='test-only-password';
 const res=await run(admin,req('/api/auth/change-password',{current_password:'test-only-password',new_password:'new-test-only-password'}));
 assert.equal(res.code,200);assert.equal((await run(admin,req('/api/auth/check',{},'GET'))).body.authenticated,false);
});
test('persistent failed login counter rate-limits subsequent requests',async()=>{
 reset();state.admin_password='test-only-password';for(let i=0;i<5;i++) assert.equal((await run(admin,req('/api/auth/login',{password:'wrong'},'POST',false))).code,401);
 assert.equal((await run(admin,req('/api/auth/login',{password:'wrong'},'POST',false))).code,429);
});
test('GET cannot delete a request or enqueue Explorer and cross-origin POST is blocked',async()=>{
 reset();assert.equal((await run(admin,req('/api/portal/request/REQ-A/delete',{},'GET'))).code,405);
 assert.equal((await run(admin,req('/api/open-explorer',{},'GET'))).code,405);
 assert.equal((await run(admin,req('/api/dispatch/mark-sent',{request_id:'REQ-A',sent:true},'POST',true,{origin:'https://another.test'}))).code,403);assert.equal(writes,0);
});
test('two matches isolate seats, requests and sending records',async()=>{
 reset();state.matches=[{id:DEFAULT_MATCH_ID,title:'Zeren Spor - Kuzeyboru'},{id:'MATCH-B',title:'Other Match'}];
 rows[1].match_name='Other Match';state.request_matches={'REQ-B':'MATCH-B'};
 await run(admin,assign('REQ-A',1));const second=assign('REQ-B',1);second.headers['x-match-id']='MATCH-B';
 assert.equal((await run(admin,second)).code,200);assert.equal(state.match_states['MATCH-B'].virtual_assignments['102:3-1'].request_id,'REQ-B');assert.equal(state.virtual_assignments['102:3-1'].request_id,'REQ-A');
 const summary=await run(admin,req('/api/excel/summary',{},'GET',true,{'x-match-id':'MATCH-B'}));assert.deepEqual(summary.body.requests.map(r=>r.request_id),['REQ-B']);
});
test('multiple Explorer commands survive and companion acknowledgements are scoped',async()=>{
 reset();await run(admin,assign('REQ-A',1));
 const one=await run(admin,req('/api/open-explorer',{request_id:'REQ-A'}));const two=await run(admin,req('/api/open-explorer',{request_id:'REQ-A'}));
 assert.notEqual(one.body.command_id,two.body.command_id);assert.equal(state.explorer_commands.length,2);
 const headers={authorization:'Bearer '+process.env.ZEREN_COMPANION_TOKEN};
 const ack=await run(admin,req('/api/companion/report',{match_id:DEFAULT_MATCH_ID,command_id:one.body.command_id,success:true},'POST',false,headers));
 assert.equal(ack.code,200);assert.equal(state.explorer_commands[0].status,'done');assert.equal(state.explorer_commands[1].status,'pending');
 const bridge=await run(admin,req('/api/companion/state?match_id='+DEFAULT_MATCH_ID,{},'GET',false,headers));
 assert.equal(bridge.code,200);assert.ok(!bridge.body[0].assigned_seats.sessions);assert.equal(bridge.body[0].assigned_seats.explorer_commands.length,1);
});
test('an invalid companion token never accesses private state',async()=>{
 reset();assert.equal((await run(admin,req('/api/companion/state?match_id='+DEFAULT_MATCH_ID,{},'GET',false))).code,401);
});
test('seat shift cannot overwrite an occupied target or lose unequal arrays',async()=>{
 reset();await run(admin,assign('REQ-A',1));await run(admin,assign('REQ-B',2));
 const before=structuredClone(state.virtual_assignments);
 const res=await run(admin,req('/api/shift',{source_seats:[{block:'102',row:3,seat:1}],target_seats:[{block:'102',row:3,seat:2}]}));
 assert.equal(res.code,409);assert.deepEqual(state.virtual_assignments,before);
});
test('a partial request only receives its remaining seats',async()=>{
 reset();rows[0].requested_count=2;await run(admin,assign('REQ-A',1));
 assert.equal((await run(admin,req('/api/excel/assign-request',{request_id:'REQ-A',block_id:'102',seat_ids:['3-2','3-3']}))).code,400);
 assert.equal(Object.keys(state.virtual_assignments).length,1);
});

test('missing server credentials fail closed without database writes',async()=>{
 reset();const role=process.env.SUPABASE_SERVICE_ROLE_KEY,legacy=process.env.SUPABASE_KEY;
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_KEY;
 try {assert.equal((await run(admin,req('/api/state',{},'GET'))).code,503);assert.equal(writes,0);}
 finally {process.env.SUPABASE_SERVICE_ROLE_KEY=role;if(legacy!==undefined)process.env.SUPABASE_KEY=legacy;}
});
test('unknown historical match does not leak into current match summary',async()=>{
 reset();rows.push(fixtureRow('OLD-OTHER',{match_name:'An unknown historical match'}));
 const result=await run(admin,req('/api/excel/summary',{},'GET'));assert.ok(!result.body.requests.some(r=>r.request_id==='OLD-OTHER'));
});
test('companion cannot invoke administrator authentication routes',async()=>{
 reset();const headers={authorization:'Bearer '+process.env.ZEREN_COMPANION_TOKEN};
 const denied=await run(admin,req('/api/companion/admin-action',{match_id:DEFAULT_MATCH_ID,path:'/api/auth/change-password',method:'POST'},'POST',false,headers));
 assert.equal(denied.code,403);assert.equal(writes,0);
 const allowed=await run(admin,req('/api/companion/admin-action',{match_id:DEFAULT_MATCH_ID,path:'/api/state',method:'GET'},'POST',false,headers));assert.equal(allowed.code,200);
});
test('inventory imports dynamic PDFs and protects manual folders from allocation',async()=>{
 reset();const headers={authorization:'Bearer '+process.env.ZEREN_COMPANION_TOKEN};
 const data={layout:{name:'102 Blok',zone:'test',court_side:'top',cols:1,capacity:1,rows:[{row:3,cells:[1]}]},tickets:{'3-1':{filename:'102 3 - -1.pdf',external_owner:{group:'Manual Person',subgroup:'Genel',status:'assigned'}}}};
 const report=()=>req('/api/companion/report',{match_id:DEFAULT_MATCH_ID,status:'online',inventory:{'102':data}},'POST',false,headers);
 assert.equal((await run(admin,report())).code,200);
 assert.equal((await run(admin,assign('REQ-A',1))).code,409);
 delete data.tickets['3-1'].external_owner;
 assert.equal((await run(admin,report())).code,200);
 assert.equal((await run(admin,assign('REQ-A',1))).code,200);
});
test('edited request metadata and tracking share the canonical snapshot',async()=>{
 reset();state.tracking_access={'REQ-A':tokenHash('a'.repeat(64))};await run(admin,assign('REQ-A',1));
 const edited=await run(admin,req('/api/portal/request/REQ-A/update',{requested_count:2,description:'Updated note'}));assert.equal(edited.code,200);
 const tracking=await run(track,req('/api/portal/my-requests',{},'GET',false,{'x-tracking-token':'REQ-A.'+'a'.repeat(64)}));
 assert.equal(tracking.body[0].requested_count,2);assert.equal(tracking.body[0].fulfillment_status,'partial');assert.equal(tracking.body[0].assigned_count,1);
});

test('virtual seats retain request identity in the returned plan',async()=>{
 reset();state.match_templates={[DEFAULT_MATCH_ID]:{blocks:{'102':{id:'102',rows:[{row:3,cells:[1]}],tickets:{}}},colors:{}}};
 const result=await run(admin,assign('REQ-A',1));assert.equal(result.code,200);
 assert.equal(result.body.blocks['102'].tickets['3-1'].request_id,'REQ-A');
});
test('no block preference chooses available inventory in another block',async()=>{
 reset();rows[0].target_block='';state.match_templates={[DEFAULT_MATCH_ID]:{blocks:{
  '102':{id:'102',rows:[{row:3,cells:[1]}],tickets:{}},
  '121':{id:'121',rows:[{row:3,cells:[1]}],tickets:{'3-1':{block:'121',row:3,seat:1,seat_id:'3-1',has_pdf:true}}}
 },colors:{}}};
 const result=await run(admin,req('/api/excel/assign-request',{request_id:'REQ-A'}));
 assert.equal(result.code,200);assert.equal(state.virtual_assignments['121:3-1'].request_id,'REQ-A');
});
test('manual PDF ownership is protected from shift and compatibility allocation',async()=>{
 reset();state.match_templates={[DEFAULT_MATCH_ID]:{blocks:{'102':{id:'102',rows:[{row:3,cells:[1,2]}],tickets:{
  '3-2':{block:'102',row:3,seat:2,external_owner:{group:'Manual Person',status:'assigned'}}
 }},},colors:{}}};
 assert.equal((await run(admin,assign('REQ-A',1))).code,200);
 const moved=await run(admin,req('/api/shift',{source_seats:[{block:'102',row:3,seat:1}],target_seats:[{block:'102',row:3,seat:2}]}));
 assert.equal(moved.code,409);assert.equal(state.virtual_assignments['102:3-1'].request_id,'REQ-A');
 const headers={authorization:'Bearer '+process.env.ZEREN_COMPANION_TOKEN};
 const assigned=await run(admin,req('/api/companion/request',{match_id:DEFAULT_MATCH_ID,operation:'assign',request_id:'REQ-B',request:{assigned_block:'102',assigned_seats:['3-2']}},'POST',false,headers));
 assert.equal(assigned.code,409);
});

test('portal rejects unsupported match blocks before registering an operation',async()=>{
 reset();const result=await run(request,req('/api/portal/request',{person:'Test Person',phone:'05321234567',requested_count:1,match_name:'Zeren Spor - Kuzeyboru',target_block:'NOT-A-BLOCK'},'POST',false));
 assert.equal(result.code,400);assert.equal(writes,0);assert.equal(rows.length,2);
});

test('staff directory is read-only and does not advertise cross-origin access',async()=>{
 const denied=await run(staff,req('/api/portal/staff',{},'POST',false));assert.equal(denied.code,405);
 const allowed=await run(staff,req('/api/portal/staff',{},'GET',false));assert.equal(allowed.code,200);
 assert.equal(allowed.headers['Access-Control-Allow-Origin'],undefined);
});

test('portal creation limits repeated submissions per client with retry guidance',async()=>{
 reset();const body={person:'Test Person',phone:'05321234567',requested_count:1,match_name:'Zeren Spor - Kuzeyboru',target_block:'102'};
 const extra={'idempotency-key':'rate-test-'.repeat(5)};
 for(let i=0;i<5;i++) assert.equal((await run(request,req('/api/portal/request',body,'POST',false,extra))).code,200);
 const limited=await run(request,req('/api/portal/request',body,'POST',false,extra));
 assert.equal(limited.code,429);assert.ok(Number(limited.headers['Retry-After'])>0);
 assert.equal(rows.filter(r=>r.id.startsWith('ZS-')).length,1);
});
test('tracking abuse is throttled before any database access',async()=>{
 reset();for(let i=0;i<25;i++) assert.equal((await run(track,req('/api/portal/my-requests',{},'GET',false))).code,401);
 const limited=await run(track,req('/api/portal/my-requests',{},'GET',false));assert.equal(limited.code,429);assert.equal(writes,0);
});

test('a legacy anon key cannot masquerade as the server database credential',async()=>{
 reset();const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_SERVICE_ROLE_KEY='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.test';
 try {const result=await run(admin,req('/api/state',{},'GET'));assert.equal(result.code,503);assert.match(result.body.detail,/service_role/);assert.equal(writes,0);}
 finally {process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});

test('legacy directory phones appear in summary and dispatch without rewriting request rows',async()=>{
 reset();rows[0].phone='';await run(admin,assign('REQ-A',1));
 const helpers={...adminHelpers,getBaseData:()=>({...adminHelpers.getBaseData(),phonebook:{'Test Person':'05320000001'}})};
 const runWithDirectory=async path=>{const res=response();await runAdmin(req(path,{},'GET'),res,await loadSystemState(),helpers);return res;};
 const before=writes;
 const summary=await runWithDirectory('/api/excel/summary');
 assert.equal(summary.body.requests.find(r=>r.request_id==='REQ-A').phone,'05320000001');
 const dispatch=await runWithDirectory('/api/dispatch/list');
 assert.equal(dispatch.body.recipients[0].clean_phone,'905320000001');
 assert.equal(rows[0].phone,'');assert.equal(writes,before);
});
test('per-request phones take priority and normalized custom directory phones reach Windows',async()=>{
 reset();rows[0].phone='';rows[1].person='Test Person';
 state.custom_phones={'TEST PERSON':'05320000002'};
 const summary=await run(admin,req('/api/excel/summary',{},'GET'));
 assert.equal(summary.body.requests.find(r=>r.request_id==='REQ-A').phone,'05320000002');
 assert.equal(summary.body.requests.find(r=>r.request_id==='REQ-B').phone,'05321234567');
 const headers={authorization:'Bearer '+process.env.ZEREN_COMPANION_TOKEN};
 const bridge=await run(admin,req('/api/companion/requests?match_id='+DEFAULT_MATCH_ID,{},'GET',false,headers));
 assert.equal(bridge.body.find(r=>r.id==='REQ-A').phone,'05320000002');
});
test('directory matching never picks an arbitrary phone for an ambiguous short name',()=>{
 assert.equal(adminHelpers.lookupPhone('Test',{'Test One':'05320000001','Test Two':'05320000002'}),'');
 assert.equal(adminHelpers.lookupPhone('Test One',{'Test One':'05320000001','Test Two':'05320000002'}),'05320000001');
});
test('summary reports directory phone and conflicting owner when another member phone was submitted',async()=>{
 reset();rows[0].person='Çağlar Oskay';rows[0].phone='05424339057';
 rows[1].person='Aysu Balcı';rows[1].phone='05424339057';
 const helpers={...adminHelpers,getBaseData:()=>({...adminHelpers.getBaseData(),phonebook:{'Aysu Balcı':'+90 542 433 90 57','Çağlar Oskay':'+90 532 548 99 11'}})};
 const res=response();await runAdmin(req('/api/excel/summary',{},'GET'),res,await loadSystemState(),helpers);
 const caglar=res.body.requests.find(r=>r.request_id==='REQ-A');
 const aysu=res.body.requests.find(r=>r.request_id==='REQ-B');
 assert.equal(caglar.phone,'05424339057');
 assert.equal(caglar.directory_phone,'+90 532 548 99 11');
 assert.equal(caglar.phone_owner,'Aysu Balcı');
 assert.equal(aysu.phone_owner,'');
});

test('dispatch retains the count and seat labels required by its existing UI',async()=>{
 reset();await run(admin,assign('REQ-A',1));
 const result=await run(admin,req('/api/dispatch/list',{},'GET'));
 assert.equal(result.body.recipients[0].ticket_count,1);
 assert.match(result.body.recipients[0].seats_formatted,/102.*3-1/);
 assert.equal(result.body.progress_pct,0);
 await run(admin,req('/api/dispatch/mark-sent',{request_id:'REQ-A',sent:true}));
 assert.equal((await run(admin,req('/api/dispatch/list',{},'GET'))).body.progress_pct,100);
});
