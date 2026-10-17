import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../src/functions/uniformEventConfig.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function run({role='admin',enabled=false,module='fieldTrip',registered=false,legacy=false}={}){
 let handler;const deleted=[],audits=[],filters=[];
 const row={rowKey:module+':sample',etag:'version1',payload:JSON.stringify({module,id:'sample',enabled,title:'test'})};
 const sandbox={console,process:{env:{STORAGE_CONNECTION_STRING:'mock'}},Date,Set,JSON,randomUUID:()=> 'audit-id',
  app:{http:(_,v)=>handler=v.handler},getTenantContext:async()=>({schoolId:'sacred-heart',access:{role,email:'admin@example.test'}}),json:(body,status=200)=>({body,status}),
  syncActivityCalendar:async()=>{},deleteActivityCalendar:async(s,a,d)=>deleted.push(['calendar',s,d.id]),
  TableClient:{fromConnectionString:(_,name)=>({createTable:async()=>{},getEntity:async()=>row,
   listEntities:async function*({queryOptions}){filters.push(queryOptions.filter);if((registered&&name==='TenantFamilyEventRegistration')||(legacy&&name==='TenantUniformEventRequest'))yield {payload:JSON.stringify({kind:module,activityId:'sample'})}},
   createEntity:async e=>audits.push(e),deleteEntity:async(...args)=>deleted.push([name,...args])})}};
 vm.runInNewContext(source,sandbox);
 const result=await handler({method:'DELETE',json:async()=>({module,id:'sample'})});return {result,deleted,audits,filters};
}
test('parent cannot delete',async()=>{const x=await run({role:'parent'});assert.equal(x.result.status,403);assert.equal(x.deleted.length,0)});
test('published event cannot delete',async()=>{const x=await run({enabled:true});assert.equal(x.result.status,409);assert.equal(x.deleted.length,0)});
test('family registration history blocks delete',async()=>{const x=await run({registered:true});assert.equal(x.result.status,409);assert.equal(x.deleted.length,0)});
test('legacy registration history blocks delete',async()=>{const x=await run({legacy:true});assert.equal(x.result.status,409);assert.equal(x.deleted.length,0)});
test('uniform modules cannot delete',async()=>{const x=await run({module:'regularUniform'});assert.equal(x.result.status,400);assert.equal(x.deleted.length,0)});
test('unused hidden event removes linked data only within school and audits',async()=>{const x=await run();assert.equal(x.result.status,200);assert.equal(x.deleted.length,3);assert.equal(x.audits[0].partitionKey,'sacred-heart');assert.equal(x.audits[0].action,'config.delete');assert.ok(x.filters.every(f=>f==="PartitionKey eq 'sacred-heart'"));assert.equal(x.deleted[2][1],'sacred-heart');assert.equal(x.deleted[2][2],'fieldTrip:sample');assert.equal(x.deleted[2][3].etag,'version1')});
