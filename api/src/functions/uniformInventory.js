import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getTenantContext,json } from "../lib/auth.js";

const name="TenantUniformInventory",auditName="TenantUniformEventAudit";
let inventory,audit;
async function clients(){
  const conn=process.env.STORAGE_CONNECTION_STRING;
  if(!conn)throw new Error("Storage unavailable");
  if(!inventory){inventory=TableClient.fromConnectionString(conn,name);await inventory.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
  if(!audit){audit=TableClient.fromConnectionString(conn,auditName);await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
  return {inventory,audit};
}
const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const validNum=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
function key(type,style,size){
  if(type==="regularUniform"&&sizes.has(size))return "regular:"+size;
  if(type==="competitionUniform"&&["男","女"].includes(style)&&((style==="男"&&["S","M","L","2L"].includes(size))||(style==="女"&&["XS","S","M","L"].includes(size))))return "competition:"+style+":"+size;
  return null;
}
async function setTshirtCounts(ctx,data,client,a){
  if(data.type!=="regularUniform"||!Array.isArray(data.items)||!data.items.length||data.items.length>sizes.size)return json({error:"請填寫要盤點的團 T 尺寸與數量"},400);
  const seen=new Set();
  for(const item of data.items){
    if(!item||!sizes.has(item.size)||seen.has(item.size)||!Number.isSafeInteger(item.onHand)||item.onHand<0||item.onHand>10000||!(item.etag===null||typeof item.etag==="string"&&item.etag.length>0&&item.etag.length<=200))return json({error:"尺寸不可重複，數量須為 0～10000 的整數；請重新讀取庫存後再試"},400);
    seen.add(item.size);
  }
  const previous=await Promise.all(data.items.map(async item=>{try{return await client.getEntity(ctx.schoolId,"regular:"+item.size)}catch(error){if(error.statusCode===404)return null;throw error}}));
  const changes=[],details=[];
  for(const [index,item] of data.items.entries()){
    const old=previous[index],id="regular:"+item.size;
    if(item.etag!==(old?.etag??null))return json({error:item.size+" 尺寸的庫存已變動，請重新讀取後核對；本次尚未儲存任何尺寸"},409);
    const before={onHand:old?.onHand??0,reserved:old?.reserved??0,unavailable:old?.unavailable??0},after={...before,onHand:item.onHand};
    if(!Object.values(after).every(validNum)||after.onHand<after.reserved+after.unavailable)return json({error:item.size+" 尺寸的盤點總數不可少於保留與不可用數量；本次尚未儲存任何尺寸"},409);
    const next={partitionKey:ctx.schoolId,rowKey:id,...after};
    changes.push(old?["update",next,"Replace",{etag:old.etag}]:["create",next]);
    details.push({key:id,before:old?before:null,after});
  }
  const auditId=randomUUID(),entry={partitionKey:ctx.schoolId,rowKey:"stock-count:"+auditId,action:"inventory.BATCH_SET_COUNT",subjectId:"regularUniform",actor:String(ctx.access.email||"admin"),at:new Date().toISOString(),details:JSON.stringify(details)};
  try{
    // All sizes and their audit record share one school partition and commit together.
    await client.submitTransaction([...changes,["create",entry]]);
  }catch(error){if([409,412].includes(error.statusCode))return json({error:"庫存已被其他人更新，請重新讀取後核對；本次尚未儲存任何尺寸"},409);throw error}
  // The transaction above remains the authoritative audit if the central index is unavailable.
  await a.createEntity({...entry,rowKey:auditId}).catch(error=>console.warn("uniformInventory batch audit index",error.statusCode||error.message));
  return json({updated:details.length});
}
app.http("uniformInventory",{
  methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/inventory",
  handler:async request=>{
    const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
    if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
    try{
      const {inventory:client,audit:a}=await clients();
      if(request.method==="GET"){
        const items=[];
        for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${ctx.schoolId.replaceAll("'","''")}'`}})){
          if(!String(e.rowKey).startsWith("regular:")&&!String(e.rowKey).startsWith("competition:"))continue;
          items.push({key:e.rowKey,onHand:e.onHand,reserved:e.reserved,unavailable:e.unavailable,etag:e.etag});
        }
        return json({items});
      }
      const data=await request.json();
      if(data?.action==="BATCH_SET_COUNT")return await setTshirtCounts(ctx,data,client,a);
      const id=key(data.type,data.style,data.size);
      if(!id||!["SET_COUNT","ADJUST","RESERVE","RELEASE"].includes(data.action))return json({error:"Invalid stock operation"},400);
      const amount=data.amount;
      if(!Number.isSafeInteger(amount)||Math.abs(amount)>10000||(data.action==="SET_COUNT"?amount<0:amount===0))return json({error:"Invalid quantity"},400);
      let previous;
      try{previous=await client.getEntity(ctx.schoolId,id)}catch(e){if(e.statusCode!==404)throw e}
      const current={onHand:previous?.onHand??0,reserved:previous?.reserved??0,unavailable:previous?.unavailable??0};
      const next={...current};
      if(data.action==="SET_COUNT"){if(!validNum(amount))return json({error:"Invalid count"},400);next.onHand=amount}
      if(data.action==="ADJUST")next.onHand+=amount;
      if(data.action==="RESERVE"){if(amount<0)return json({error:"Invalid reserve"},400);next.reserved+=amount}
      if(data.action==="RELEASE"){if(amount<0)return json({error:"Invalid release"},400);next.reserved-=amount}
      if(!Object.values(next).every(validNum)||next.onHand-next.reserved-next.unavailable<0)return json({error:"Insufficient stock"},409);
      // An audit row is written before the inventory mutation. Concurrency conflicts are rejected.
      await a.createEntity({partitionKey:ctx.schoolId,rowKey:randomUUID(),action:"inventory."+data.action,subjectId:id,actor:String(ctx.access.email||"admin"),at:new Date().toISOString(),details:JSON.stringify({before:current,after:next})});
      const entity={partitionKey:ctx.schoolId,rowKey:id,...next};
      try{
        if(previous)await client.updateEntity(entity,"Replace",{etag:previous.etag});
        else await client.createEntity(entity);
      }catch(e){if([409,412].includes(e.statusCode))return json({error:"Stock changed; refresh and retry"},409);throw e}
      return json({key:id,...next});
    }catch(e){console.error("uniformInventory",e);return json({error:"Inventory operation failed"},500)}
  }
});
