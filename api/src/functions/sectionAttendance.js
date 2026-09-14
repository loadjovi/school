import { app } from "@azure/functions";
import { getAccess, ensureSectionAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster } from "../lib/storage.js";
app.http("sectionAttendance",{methods:["POST"],authLevel:"anonymous",route:"section-attendance",handler:async(request)=>{
  const a=await getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(!(a.role==="admin"||a.capabilities?.section))return json({error:"Forbidden"},403);
  const body=await request.json(); const items=Array.isArray(body.items)?body.items:[];
  if(!body.sessionDate||!items.length)return json({error:"缺少日期或點名資料"},400);
  await ensureTables(); const client=table("section");
  for(const item of items){
    const master=await getStudentMaster(item.studentId);
    if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
    const view={studentId:master.rowKey,groupName:master.groupName,section:master.section||"待確認"};
    if(!ensureSectionAccess(a,view))return json({error:`無此分部課權限：${master.studentName}`},403);
    const section=String(master.section||body.section||"");
    const groupName=String(master.groupName||body.groupName||"");
    await client.createEntity({partitionKey:item.studentId,rowKey:rowKey("s"),eventDate:body.sessionDate,section,groupName,status:item.status,minutes:Number(item.minutes||0),teacher:a.email,classType:"section",createdAt:new Date().toISOString()});
  }
  return json({ok:true,count:items.length},201);
}});
