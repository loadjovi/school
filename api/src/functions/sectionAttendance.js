
import { app } from "@azure/functions";
import { getAccess, ensureStudentAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey } from "../lib/storage.js";
app.http("sectionAttendance",{methods:["POST"],authLevel:"anonymous",route:"section-attendance",handler:async(request)=>{
  const a=getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(!["sectionTeacher","admin"].includes(a.role))return json({error:"Forbidden"},403);
  const body=await request.json(); const items=Array.isArray(body.items)?body.items:[];
  if(!body.sessionDate||!items.length)return json({error:"缺少日期或點名資料"},400);
  await ensureTables(); const client=table("section");
  for(const item of items){
    if(!ensureStudentAccess(a,item.studentId))return json({error:`無權限存取 ${item.studentId}`},403);
    await client.createEntity({partitionKey:item.studentId,rowKey:rowKey("s"),eventDate:body.sessionDate,section:String(body.section||a.section||""),status:item.status,minutes:Number(item.minutes||0),teacher:a.email,createdAt:new Date().toISOString()});
  }
  return json({ok:true,count:items.length},201);
}});
