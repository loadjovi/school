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
      const data=await request.json(),id=key(data.type,data.style,data.size);
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
