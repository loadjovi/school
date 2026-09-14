import { app } from "@azure/functions";
import { getAccess, ensurePrivateAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey } from "../lib/storage.js";
app.http("privateLesson",{methods:["POST"],authLevel:"anonymous",route:"private-lesson",handler:async(request)=>{
  const a=await getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(!(a.role==="admin"||a.capabilities?.private))return json({error:"Forbidden"},403);
  const body=await request.json();
  if(!body.studentId||!ensurePrivateAccess(a,body.studentId))return json({error:"此老師未綁定該學生的個別課權限"},403);
  await ensureTables();
  await table("privateLesson").createEntity({partitionKey:body.studentId,rowKey:rowKey("i"),eventDate:body.lessonDate,status:body.status,minutes:Number(body.minutes||0),lessonContent:String(body.lessonContent||"").slice(0,500),teacher:a.email,createdAt:new Date().toISOString()});
  return json({ok:true},201);
}});
