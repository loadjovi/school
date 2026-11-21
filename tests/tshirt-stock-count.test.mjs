import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const allSizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
function backend(){
 let handler,schoolId="school-a",role="admin",sequence=0,beforeCommit=()=>{},failAudit=false,failTransaction=false;
 const rows=new Map(),audits=[],transactions=[];
 const key=row=>row.partitionKey+"|"+row.rowKey;
 const missing=()=>Object.assign(Error("missing"),{statusCode:404});
 const conflict=()=>Object.assign(Error("conflict"),{statusCode:412});
 const inventory={createTable:async()=>{},getEntity:async(p,r)=>{const row=rows.get(p+"|"+r);if(!row)throw missing();return {...row}},
  listEntities:async function*(){for(const row of rows.values())if(row.partitionKey===schoolId)yield {...row}},
  createEntity:async row=>{if(rows.has(key(row)))throw conflict();rows.set(key(row),{...row,etag:"v"+(++sequence)})},
  updateEntity:async(row,mode,options)=>{if(rows.get(key(row))?.etag!==options.etag)throw conflict();rows.set(key(row),{...row,etag:"v"+(++sequence)})},
  submitTransaction:async actions=>{
   beforeCommit();if(failTransaction)throw Object.assign(Error("offline"),{statusCode:503});
   const staged=new Map(rows);assert.ok(actions.length<=100);assert.equal(new Set(actions.map(([,row])=>row.partitionKey)).size,1);
   for(const [action,row,,options] of actions){const old=staged.get(key(row));if(action==="create"?!!old:old?.etag!==options.etag)throw conflict();staged.set(key(row),{...row,etag:"v"+(++sequence)})}
   rows.clear();for(const [k,row] of staged)rows.set(k,row);transactions.push(actions);
  }};
 const audit={createTable:async()=>{},createEntity:async row=>{if(failAudit)throw Error("index unavailable");audits.push(row)}};
 runInNewContext(read("api/src/functions/uniformInventory.js").replace(/^import .*;\n/gm,""),{
  app:{http:(_,config)=>{handler=config.handler}},TableClient:{fromConnectionString:(_,name)=>name==="TenantUniformInventory"?inventory:audit},randomUUID:()=>"batch-"+(++sequence),
  getTenantContext:async()=>({schoolId,access:{role,email:"admin@example.test"}}),json:(jsonBody,status=200)=>({status,jsonBody}),process:{env:{STORAGE_CONNECTION_STRING:"test"}},console:{warn(){},error(){}}
 });
 const call=(body,method="POST")=>handler({method,json:async()=>body});
 return {rows,audits,transactions,call,get:()=>call(null,"GET"),seed:(size,onHand,extra={})=>{const row={partitionKey:schoolId,rowKey:"regular:"+size,onHand,reserved:0,unavailable:0,etag:"original-"+size,...extra};rows.set(key(row),row);return row},
  setRole:value=>{role=value},setSchool:value=>{schoolId=value},beforeCommit:fn=>{beforeCommit=fn},failAudit:()=>{failAudit=true},failTransaction:()=>{failTransaction=true}};
}
const batch=items=>({type:"regularUniform",action:"BATCH_SET_COUNT",items});

test("all eleven T-shirt sizes commit together, including explicit zero, with a durable school audit",async()=>{
 const h=backend();h.seed("S",3,{reserved:1,unavailable:1});h.rows.set("school-b|regular:S",{partitionKey:"school-b",rowKey:"regular:S",onHand:99});
 const result=await h.call(batch(allSizes.map(size=>({size,onHand:size==="S"?6:0,etag:size==="S"?"original-S":null}))));
 assert.equal(result.status,200);assert.equal(result.jsonBody.updated,11);assert.equal(h.transactions.length,1);assert.equal(h.transactions[0].length,12);
 const saved=(await h.get()).jsonBody.items;assert.equal(saved.length,11);assert.equal(saved.find(x=>x.key==="regular:M").onHand,0);
 assert.deepEqual(JSON.parse(JSON.stringify(saved.find(x=>x.key==="regular:S"))),{key:"regular:S",onHand:6,reserved:1,unavailable:1,etag:saved.find(x=>x.key==="regular:S").etag});
 assert.equal(h.rows.get("school-b|regular:S").onHand,99);assert.equal(h.audits.length,1);assert.equal(h.audits[0].actor,"admin@example.test");
 const audit=[...h.rows.values()].find(row=>row.rowKey.startsWith("stock-count:"));assert.equal(audit.partitionKey,"school-a");assert.equal(JSON.parse(audit.details).length,11);
});
test("a partial count leaves unfilled sizes uncreated and preserves unrelated competition stock",async()=>{
 const h=backend();h.rows.set("school-a|competition:男:S",{partitionKey:"school-a",rowKey:"competition:男:S",onHand:7});
 assert.equal((await h.call(batch([{size:"M",onHand:4,etag:null}]))).status,200);
 const items=(await h.get()).jsonBody.items;assert.equal(items.length,2);assert.ok(!items.some(x=>x.key==="regular:8"));assert.equal(items.find(x=>x.key==="competition:男:S").onHand,7);
});
test("invalid or repeated sizes and invalid counts reject the entire count without writes",async()=>{
 const good={size:"S",onHand:2,etag:null};
 for(const items of [[],[good,good],[good,{size:"4L",onHand:1,etag:null}],[good,{size:"M",onHand:-1,etag:null}],[good,{size:"M",onHand:1.5,etag:null}],[good,{size:"M",onHand:10001,etag:null}],[good,{size:"M",onHand:"2",etag:null}],[{size:"M",onHand:2}]]){
  const h=backend();assert.equal((await h.call(batch(items))).status,400);assert.equal(h.rows.size,0);assert.equal(h.audits.length,0);
 }
});
test("reserved stock, stale counts and a concurrent receiving update cannot cause partial batch writes",async()=>{
 for(const scenario of ["reserved","stale","concurrent"]){
  const h=backend(),stock=h.seed("S",5,{reserved:2,unavailable:1});
  if(scenario==="concurrent")h.beforeCommit(()=>h.rows.set("school-a|regular:S",{...stock,onHand:6,etag:"new-version"}));
  const result=await h.call(batch([{size:"M",onHand:8,etag:null},{size:"S",onHand:scenario==="reserved"?2:7,etag:scenario==="stale"?"stale":"original-S"}]));
  assert.equal(result.status,409);assert.equal(h.transactions.length,0);assert.ok(!h.rows.has("school-a|regular:M"));assert.equal(h.rows.get("school-a|regular:S").onHand,scenario==="concurrent"?6:5);assert.equal(h.audits.length,0);
 }
});
test("a concurrently created size aborts every other size in the same count",async()=>{
 const h=backend();h.beforeCommit(()=>h.rows.set("school-a|regular:S",{partitionKey:"school-a",rowKey:"regular:S",onHand:9,etag:"new"}));
 assert.equal((await h.call(batch([{size:"M",onHand:3,etag:null},{size:"S",onHand:2,etag:null}]))).status,409);assert.ok(!h.rows.has("school-a|regular:M"));assert.equal(h.rows.get("school-a|regular:S").onHand,9);
});
test("a failed transaction writes nothing; an unavailable audit index does not erase committed counts or their audit",async()=>{
 const failed=backend();failed.failTransaction();assert.equal((await failed.call(batch([{size:"S",onHand:2,etag:null}]))).status,500);assert.equal(failed.rows.size,0);
 const h=backend();h.failAudit();assert.equal((await h.call(batch([{size:"S",onHand:2,etag:null}]))).status,200);assert.equal(h.rows.size,2);assert.equal((await h.get()).jsonBody.items.length,1);
});
test("parents and teachers cannot batch-count stock, and another school cannot overwrite its source",async()=>{
 const h=backend();h.seed("S",5);for(const role of ["parent","teacher"]){h.setRole(role);assert.equal((await h.call(batch([{size:"S",onHand:2,etag:"original-S"}]))).status,403)}
 h.setRole("admin");h.setSchool("school-b");assert.equal((await h.call(batch([{size:"S",onHand:2,etag:"original-S"}]))).status,409);assert.equal(h.rows.get("school-a|regular:S").onHand,5);
});
test("existing single-size adjustments still preserve reserved stock",async()=>{
 const h=backend();h.seed("S",5,{reserved:1});assert.equal((await h.call({type:"regularUniform",size:"S",action:"ADJUST",amount:2})).status,200);assert.equal(h.rows.get("school-a|regular:S").onHand,7);assert.equal(h.rows.get("school-a|regular:S").reserved,1);
});

class Element{
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.attributes={};this.value="";this.textContent="";this.disabled=false}
 append(...children){this.children.push(...children)}
 replaceChildren(...children){this.children=children}
 setAttribute(name,value){this.attributes[name]=value}
 addEventListener(name,fn){this.handlers[name]=fn}
 contains(child){return this===child||this.children.some(node=>node.contains(child))}
 querySelector(selector){return descendants(this).find(node=>"#"+node.id===selector)||null}
 focus(){this.focused=true}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
function frontend(stock=[]){
 const host=new Element("div"),calls=[];let counter,reloads=0,fail=false,reloadFail=false,hold=null;
 const scope={document:{createElement:tag=>new Element(tag)}};
 const create=runInNewContext(read("app/tshirt-stock-count.js").replace("export function","function")+";createTshirtStockCounter",scope);
 counter=create({host,api:async(path,options)=>{
  const body=JSON.parse(options.body);calls.push({path,body});if(hold)await hold;if(fail)throw Error("資料已更新，請重新讀取");
  for(const item of body.items){const next={key:"regular:"+item.size,onHand:item.onHand,reserved:0,unavailable:0,etag:"updated"},old=stock.findIndex(x=>x.key===next.key);if(old<0)stock.push(next);else stock[old]={...stock[old],...next}}
  return {updated:body.items.length};
 },onReload:async()=>{reloads++;if(reloadFail)throw Error("讀取逾時");counter.render(stock)}});
 counter.render(stock);
 const form=()=>host.children[0],input=size=>descendants(form()).find(node=>node.name==="count-"+size),status=()=>host.querySelector("#tshirtStockCountStatus"),buttons=()=>descendants(form()).filter(node=>node.tag==="button");
 return {host,counter,calls,stock,form,input,status,buttons,reloads:()=>reloads,edit:(size,value)=>{input(size).value=value;form().handlers.input()},submit:()=>form().handlers.submit({preventDefault(){}}),setFail:value=>{fail=value},setReloadFail:value=>{reloadFail=value},hold:promise=>{hold=promise}};
}
test("one save sends only edited sizes, explicit zero creates a counted size, and blanks stay uncounted",async()=>{
 const h=frontend();assert.equal(descendants(h.form()).filter(node=>node.tag==="input").length,11);h.edit("8","2");h.edit("S","0");await h.submit();
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,batch([{size:"8",onHand:2,etag:null},{size:"S",onHand:0,etag:null}]));assert.equal(h.reloads(),1);assert.equal(h.input("S").value,"0");assert.equal(h.input("M").value,"");assert.match(h.status().textContent,/已一次儲存 2 個尺寸/);assert.equal(h.input("M").attributes["aria-label"],"M 尺寸盤點數量");
});
test("existing counts prefill the form and unchanged or blank existing values are not submitted",async()=>{
 const h=frontend([{key:"regular:S",onHand:4,reserved:1,unavailable:0,etag:"v1"}]);assert.equal(h.input("S").value,"4");await h.submit();assert.equal(h.calls.length,0);
 h.edit("S","");h.edit("M","3");await h.submit();assert.deepEqual(h.calls[0].body.items,[{size:"M",onHand:3,etag:null}]);assert.equal(h.input("S").value,"4");
});
test("invalid or below-reserved counts never issue a write",async()=>{
 for(const value of ["-1","1.5","10001","abc","1"]){const h=frontend([{key:"regular:S",onHand:4,reserved:2,unavailable:0,etag:"v1"}]);h.edit("S",value);await h.submit();assert.equal(h.calls.length,0);assert.equal(h.input("S").focused,true)}
});
test("background refresh preserves a draft and explicit reload replaces it with fresh data",async()=>{
 const h=frontend([{key:"regular:S",onHand:4,etag:"v1"}]);h.edit("S","7");const draft=h.form();h.stock[0]={key:"regular:S",onHand:5,etag:"v2"};h.counter.render(h.stock);assert.equal(h.form(),draft);assert.equal(h.input("S").value,"7");
 await h.buttons()[1].handlers.click();assert.notEqual(h.form(),draft);assert.equal(h.input("S").value,"5");h.edit("S","6");await h.submit();assert.equal(h.calls[0].body.items[0].etag,"v2");
});
test("repeat clicks while saving produce one batch and a rejected save retains all entered counts",async()=>{
 const h=frontend();let release;h.hold(new Promise(resolve=>{release=resolve}));h.edit("S","2");const pending=h.submit();await h.submit();assert.equal(h.calls.length,1);assert.equal(h.buttons()[0].disabled,true);release();await pending;
 const failed=frontend();failed.setFail(true);failed.edit("S","3");await failed.submit();assert.equal(failed.input("S").value,"3");assert.match(failed.status().textContent,/儲存未確認/);assert.equal(failed.buttons()[0].disabled,false);
});
test("a committed count followed by a read failure asks for reload and cannot be resubmitted with stale versions",async()=>{
 const h=frontend();h.setReloadFail(true);h.edit("S","3");await h.submit();assert.match(h.status().textContent,/庫存已儲存，請重新讀取/);assert.equal(h.buttons()[0].disabled,true);await h.submit();assert.equal(h.calls.length,1);
 h.setReloadFail(false);await h.buttons()[1].handlers.click();assert.equal(h.input("S").value,"3");assert.equal(h.buttons()[0].disabled,false);
});
