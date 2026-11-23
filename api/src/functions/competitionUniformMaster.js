import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {defaultTenantId,listStudentMaster} from "../lib/storage.js";
import {baseForStudent,latestCompetitionRequest,migrateAndListCompetitionMaster,upsertCurrentCompetitionMaster} from "../lib/competitionUniformMaster.js";

app.http("competitionUniformMaster",{
 methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/competition-master",
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
   if(request.method==="POST"){
    const {studentId}=await request.json();
    if(schoolId!==defaultTenantId()||typeof studentId!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(studentId))return json({error:"請選擇聖心比賽服原始名冊的學生"},400);
    const student=students.find(row=>String(row.rowKey||row.studentId||"")===studentId);
    if(!student||!baseForStudent(student))return json({error:"找不到此生的原始比賽服登記"},404);
    if(latestCompetitionRequest(requests,studentId))return json({error:"此生已有正式申請，請從申請頁處理"},409);
    const item=await upsertCurrentCompetitionMaster(schoolId,student,null,access.email||"admin",true);
    return json({item});
   }
   const result=await migrateAndListCompetitionMaster(schoolId,students,requests,access.email||"admin");
   return json({...result,historicalReceiptAvailable:schoolId===defaultTenantId()});
  }catch(error){
   console.error("competitionUniformMaster",error);
   return json({error:"比賽服主檔同步失敗，為避免匯出錯誤資料，請稍後重新整理"},503);
  }
 }
});
