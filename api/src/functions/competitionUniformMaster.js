import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {listStudentMaster} from "../lib/storage.js";
import {migrateAndListCompetitionMaster} from "../lib/competitionUniformMaster.js";

app.http("competitionUniformMaster",{
 methods:["GET"],authLevel:"anonymous",route:"uniform-events/competition-master",
 handler:async request=>{
  const ctx=await getTenantContext(request);
  if(ctx.error)return ctx.error;
  const {access,schoolId}=ctx;
  if(access.role!=="admin")return json({error:"僅校方管理員可查詢比賽服正式主檔"},403);
  try{
   const connection=process.env.STORAGE_CONNECTION_STRING;
   if(!connection)return json({error:"儲存服務尚未設定"},503);
   const client=TableClient.fromConnectionString(connection,"TenantUniformEventRequest");
   const [students]=await Promise.all([listStudentMaster("",schoolId)]);
   const requests=[];
   for await(const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    const item=JSON.parse(row.payload||"{}");
    if(item.kind==="competitionUniform")requests.push({...item,id:row.rowKey,updatedAt:item.updatedAt||row.updatedAt});
   }
   const result=await migrateAndListCompetitionMaster(schoolId,students,requests,access.email||"admin");
   return json(result);
  }catch(error){
   console.error("competitionUniformMaster",error);
   return json({error:"比賽服主檔同步失敗，為避免匯出錯誤資料，請稍後重新整理"},503);
  }
 }
});
