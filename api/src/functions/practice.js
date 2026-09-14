import { app } from "@azure/functions";
import { getAccess, ensureStudentAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listByStudent } from "../lib/storage.js";
function minutesBetween(start,end){
  const [sh,sm]=String(start||"").split(":").map(Number),[eh,em]=String(end||"").split(":").map(Number);
  if([sh,sm,eh,em].some(Number.isNaN))return -1;
  let m=(eh*60+em)-(sh*60+sm);if(m<0)m+=1440;return m;
}
app.http("practice",{methods:["GET","POST"],authLevel:"anonymous",route:"practice",handler:async(request)=>{
  const a=await getAccess(request);if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(request.method==="GET"){
    const studentId=request.query.get("studentId"),month=request.query.get("month");
    if(!studentId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
    const start=month?`${month}-01`:null;
    const end=month?`${month}-31`:null;
    const rows=await listByStudent("practice",studentId,start,end);
    return json({items:rows.map(x=>({practiceDate:x.eventDate,startTime:x.startTime,endTime:x.endTime,minutes:x.minutes,qualified:x.qualified,practiceContent:x.practiceContent,focus:x.focus}))});
  }
  if(a.role!=="parent"&&a.role!=="admin")return json({error:"此角色不可新增自主練習"},403);
  const body=await request.json();
  if(!body.studentId||!ensureStudentAccess(a,body.studentId))return json({error:"Forbidden"},403);
  const minutes=minutesBetween(body.startTime,body.endTime);
  if(minutes<=0||minutes>240)return json({error:"練習時間不合法"},400);
  if(body.parentConfirmed!==true)return json({error:"需要家長確認"},400);
  await ensureTables();
  await table("practice").createEntity({
    partitionKey:body.studentId,rowKey:rowKey("p"),eventDate:body.practiceDate,
    startTime:body.startTime,endTime:body.endTime,minutes,qualified:minutes>=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15),
    practiceContent:String(body.practiceContent||"").slice(0,500),focus:String(body.focus||"").slice(0,100),
    confirmed:true,createdBy:a.email,createdAt:new Date().toISOString()
  });
  return json({ok:true,minutes,qualified:minutes>=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15)},201);
}});
