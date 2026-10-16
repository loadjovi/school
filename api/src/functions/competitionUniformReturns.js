import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json,parseJsonEnv} from "../lib/auth.js";
import {getStudentMaster,getMappedStudentsByEmail,getTeacherDirectory,defaultTenantId} from "../lib/storage.js";

const reply=(error,status)=>json({error},status);
const validId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const validSize=(style,size)=>(style==="男"&&["S","M","L","2L"].includes(size))||(style==="女"&&["XS","S","M","L"].includes(size));
const get=async(table,schoolId,key)=>{try{return await table.getEntity(schoolId,key)}catch(e){if(e.statusCode===404)return null;throw e}};
const stamp=()=>new Date().toISOString();
const publicView=x=>({id:x.rowKey,studentId:x.studentId,studentName:x.studentName,sourceRequestId:x.sourceRequestId||"",source:x.source,style:x.style,size:x.size,status:x.status,sourceNote:x.sourceNote||"",receivedAt:x.receivedAt||"",receivedBy:x.receivedBy||"",washingAt:x.washingAt||"",stockedAt:x.stockedAt||"",stockedBy:x.stockedBy||"",stockedByName:x.stockedByName||"",rejectedAt:x.rejectedAt||"",updatedAt:x.updatedAt||"",etag:x.etag});
async function operatorLabel(email,schoolId){
 const account=String(email||"").trim().toLowerCase();
 if(!account||account==="admin")return "";
 try{
  const teacher=await getTeacherDirectory(account,schoolId);
  if(teacher?.status==="active"&&teacher.teacherName){
   const name=String(teacher.teacherName).trim();
   return name.endsWith("老師")?name:name+"老師";
  }
 }catch(error){console.warn("competition return teacher lookup",error)}
 let mapped=[];
 try{mapped=await getMappedStudentsByEmail(account,schoolId)}catch(error){console.warn("competition return operator mapping",error)}
 const parentMap=schoolId===defaultTenantId()?parseJsonEnv("STUDENT_MAP_JSON",{}):{};
 const legacy=Object.entries(parentMap).find(([key])=>key.trim().toLowerCase()===account)?.[1];
 const legacyStudents=Array.isArray(legacy)?legacy:(Array.isArray(legacy?.students)?legacy.students:[]);
 const names=[...new Set([...mapped,...legacyStudents].map(student=>String(student?.name||student?.studentName||"").trim()).filter(Boolean))];
 return names.length?names.join("、")+"家長":"";
}

// A public uniform is returned once per issuance. The return ledger and stock
// increment share one Azure Table transaction, so retries cannot add twice.
app.http("competitionUniformReturns",{
 methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/competition-returns",
 handler:async request=>{
  const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
  if(ctx.access.role!=="admin")return reply("僅校方管理員可辦理公費比賽服歸還",403);
  try{
   const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
   const schoolId=ctx.schoolId,inventory=TableClient.fromConnectionString(conn,"TenantUniformInventory"),orders=TableClient.fromConnectionString(conn,"TenantUniformEventRequest");
   await inventory.createTable().catch(e=>{if(e.statusCode!==409)throw e});
   if(request.method==="GET"){
    const items=[],issues=[];
    for await(const row of inventory.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
     if(row.rowKey.startsWith("return:"))items.push(publicView(row));
     if(row.rowKey.startsWith("issued:")&&row.kind==="competitionUniform"){
      const order=await get(orders,schoolId,row.requestId);if(!order)continue;
      const data=JSON.parse(order.payload||"{}");
      if(data.acquisition!=="PUBLIC"||data.status!=="FULFILLED")continue;
      const student=await getStudentMaster(row.studentId,schoolId);
      issues.push({requestId:row.requestId,studentId:row.studentId,studentName:student?.studentName||row.studentId,style:row.style,size:row.size,issuedAt:row.issuedAt});
     }
    }
    const labels=new Map();
    for(const item of items){
     if(item.status!=="STOCKED"||!item.stockedBy)continue;
     if(!labels.has(item.stockedBy))labels.set(item.stockedBy,await operatorLabel(item.stockedBy,schoolId));
     item.stockedByLabel=labels.get(item.stockedBy);
    }
    return json({items,issues});
   }
   const input=await request.json(),action=input?.action;
   if(!["REGISTER","WASHING","ACCEPT","REJECT"].includes(action))return reply("無效的歸還操作",400);
   const actor=String(ctx.access.email||"admin").slice(0,200);
   const actorName=String(ctx.access.displayName||"").slice(0,100),now=stamp();
   if(action==="REGISTER"){
    let studentId,student,style,size,source,sourceRequestId="",sourceNote="";
    if(input.source==="FORMAL"){
     if(!validId(input.sourceRequestId))return reply("請選擇正式公費領用紀錄",400);
     const order=await get(orders,schoolId,input.sourceRequestId),issued=await get(inventory,schoolId,"issued:"+input.sourceRequestId);
     if(!order||!issued)return reply("找不到已完成的正式領用紀錄",409);
     const data=JSON.parse(order.payload||"{}");
     if(data.status!=="FULFILLED"||data.kind!=="competitionUniform"||data.acquisition!=="PUBLIC"||String(data.studentId)!==String(issued.studentId))return reply("此筆不是已發放的公費比賽服",409);
     studentId=String(issued.studentId);style=issued.style;size=issued.size;source="FORMAL";sourceRequestId=input.sourceRequestId;
    }else if(input.source==="HISTORICAL"){
     if(!validId(input.studentId)||!validSize(input.style,input.size)||typeof input.sourceNote!=="string"||input.sourceNote.trim().length<8||input.sourceNote.length>300)
      return reply("請填學生學號、實物款式尺寸及至少 8 字的紙本領用佐證",400);
     studentId=input.studentId;style=input.style;size=input.size;source="HISTORICAL";sourceNote=input.sourceNote.trim();
     // A formal issue must use its durable issuance ledger, not a manual entry.
     for await(const row of orders.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
      const data=JSON.parse(row.payload||"{}");
      if(String(data.studentId)===studentId&&data.kind==="competitionUniform"&&data.acquisition==="PUBLIC"&&data.status==="FULFILLED")return reply("此學生已有正式公費發放紀錄，請改選正式領用來源",409);
     }
    }else return reply("請選擇領用來源",400);
    if(!validSize(style,size))return reply("原領用款式或尺寸有誤",409);
    student=await getStudentMaster(studentId,schoolId);if(!student)return reply("找不到學生主檔，請先核對學號",409);
    const key="return:"+(source==="FORMAL"?sourceRequestId:"legacy:"+studentId);
    if(await get(inventory,schoolId,key))return reply("此筆公費領用已登記歸還，請重新整理",409);
    const stockNow=input.confirmWashedAndStock===true;
    const entity={partitionKey:schoolId,rowKey:key,studentId,studentName:String(student.studentName||studentId),source,sourceRequestId,sourceNote,style,size,status:stockNow?"STOCKED":"RECEIVED",receivedAt:now,receivedBy:actor,updatedAt:now,updatedBy:actor};
    if(stockNow){
     const stockKey="competition:"+style+":"+size,stock=await get(inventory,schoolId,stockKey);
     const onHand=stock?.onHand??0,reserved=stock?.reserved??0,unavailable=stock?.unavailable??0;
     if(![onHand,reserved,unavailable].every(v=>Number.isSafeInteger(v)&&v>=0)||onHand>=100000)return reply("庫存數量異常，請先核對",409);
     entity.washingAt=now;entity.washingBy=actor;entity.stockedAt=now;entity.stockedBy=actor;entity.stockedByName=actorName;
     const stockEntity={partitionKey:schoolId,rowKey:stockKey,onHand:onHand+1,reserved,unavailable};
     try{await inventory.submitTransaction([
      ["create",entity],
      stock?["update",stockEntity,"Replace",{etag:stock.etag}]:["create",stockEntity]
     ])}catch(e){if([409,412].includes(e.statusCode))return reply("歸還或庫存已變更，請重新整理核對",409);throw e}
    }else{
     try{await inventory.createEntity(entity)}catch(e){if(e.statusCode===409)return reply("此筆歸還已建立，請重新整理",409);throw e}
    }
    return json({item:publicView(entity)});
   }
   if(typeof input.id!=="string"||!/^return:(?:[a-zA-Z0-9_-]{1,100}|legacy:[a-zA-Z0-9_-]{1,100})$/.test(input.id)||typeof input.etag!=="string")return reply("請重新載入歸還紀錄",400);
   const old=await get(inventory,schoolId,input.id);if(!old)return reply("找不到歸還紀錄",404);
   if(old.etag!==input.etag)return reply("紀錄已更新，請重新整理",409);
   // Confirming the completed wash is the stocking action. Old WASHING
   // records remain finishable without requiring another state transition.
   const allowed={WASHING:["RECEIVED"],ACCEPT:["RECEIVED","WASHING"],REJECT:["RECEIVED","WASHING"]};
   const target={WASHING:"WASHING",ACCEPT:"STOCKED",REJECT:"REJECTED"}[action];
   if(!allowed[action].includes(old.status))return reply(old.status===target?"這個步驟已完成，請重新整理":"請依序辦理歸還、送洗、驗收入庫",409);
   const next={...old,status:target,updatedAt:now,updatedBy:actor};
   delete next.etag;delete next.timestamp;
   if(action==="WASHING")next.washingAt=now;
   if(action==="REJECT"){
    if(typeof input.reason!=="string"||input.reason.trim().length<3||input.reason.length>300)return reply("請填寫不合格原因",400);
    next.rejectedAt=now;next.rejectReason=input.reason.trim();
   }
   if(action==="ACCEPT"){
    if(!validSize(old.style,old.size))return reply("款式尺寸不正確，無法入庫",409);
    const stockKey="competition:"+old.style+":"+old.size,stock=await get(inventory,schoolId,stockKey);
    const onHand=stock?.onHand??0,reserved=stock?.reserved??0,unavailable=stock?.unavailable??0;
    if(![onHand,reserved,unavailable].every(v=>Number.isSafeInteger(v)&&v>=0)||onHand>=100000)return reply("庫存數量異常，請先核對",409);
    next.washingAt=old.washingAt||now;next.washingBy=old.washingBy||actor;
    next.stockedAt=now;next.stockedBy=actor;next.stockedByName=actorName;
    const entity={partitionKey:schoolId,rowKey:stockKey,onHand:onHand+1,reserved,unavailable};
    try{await inventory.submitTransaction([
     ["update",next,"Replace",{etag:old.etag}],
     stock?["update",entity,"Replace",{etag:stock.etag}]:["create",entity]
    ])}catch(e){if([409,412].includes(e.statusCode))return reply("歸還或庫存已變更，請重新整理",409);if((await get(inventory,schoolId,input.id))?.status!=="STOCKED")throw e}
   }else{
    try{await inventory.updateEntity(next,"Replace",{etag:old.etag})}catch(e){if(e.statusCode===412)return reply("紀錄已變更，請重新整理",409);throw e}
   }
   return json({item:publicView(await get(inventory,schoolId,input.id))});
  }catch(e){console.error("competitionUniformReturns",e);return reply("歸還結果未確認，請重新整理並核對庫存與紀錄，避免重複操作",500)}
 }
});
