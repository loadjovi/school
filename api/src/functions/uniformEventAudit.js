import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
app.http("uniformEventAudit",{methods:["GET"],authLevel:"anonymous",route:"uniform-events/audit",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
 try{
  const conn=process.env.STORAGE_CONNECTION_STRING;
  if(!conn)throw Error("Storage unavailable");
  const t=TableClient.fromConnectionString(conn,"TenantUniformEventAudit");
  await t.createTable().catch(e=>{if(e.statusCode!==409)throw e});
  const records=[];
  for await(const row of t.listEntities({queryOptions:{filter:`PartitionKey eq '${ctx.schoolId.replaceAll("'","''")}'`}})){
   records.push({id:row.rowKey,at:row.at||null,actor:row.actor||"unknown",action:row.action||"unknown",subjectId:row.subjectId||"",details:row.details||""});
  }
  records.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  return json({items:records.slice(0,200)});
 }catch(e){console.error("uniformEventAudit",e);return json({error:"Unable to read audit records"},500)}
}});
