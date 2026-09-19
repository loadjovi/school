import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, listByStudent, tenantStudentPartition, activityStudentId } from "../lib/storage.js";
function minutesBetween(start,end){
  const [sh,sm]=String(start||"").split(":").map(Number),[eh,em]=String(end||"").split(":").map(Number);
  if([sh,sm,eh,em].some(Number.isNaN))return -1;
  let m=(eh*60+em)-(sh*60+sm);if(m<0)m+=1440;return m;
}
app.http("practice",{methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"practice",handler:async(request)=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  if(request.method==="GET"){
    const studentId=request.query.get("studentId"),month=request.query.get("month");
    if(!studentId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
    const start=month?`${month}-01`:null;
    const end=month?`${month}-31`:null;
    const aliases=await getStudentIdAliases(studentId,schoolId);
    const rows=(await Promise.all(aliases.map(id=>listByStudent("practice",id,start,end,schoolId)))).flat().sort((x,y)=>String(y.eventDate||"").localeCompare(String(x.eventDate||""))||String(y.createdAt||"").localeCompare(String(x.createdAt||"")));
    return json({items:rows.map(x=>({practiceId:String(x.rowKey||""),studentId:activityStudentId(x),practiceDate:x.eventDate,startTime:x.startTime,endTime:x.endTime,minutes:x.minutes,qualified:x.qualified,practiceContent:x.practiceContent,focus:x.focus,createdBy:String(x.createdBy||""),createdAt:String(x.createdAt||"")}))});
  }

  if(request.method==="DELETE"){
    if(a.role!=="parent"&&a.role!=="admin")return json({error:"此角色不可刪除自主練習"},403);
    const body=await request.json();
    const studentId=String(body.studentId||"").trim(),practiceId=String(body.practiceId||"").trim();
    if(!studentId||!practiceId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
    const aliases=await getStudentIdAliases(studentId,schoolId);
    let entity=null,partitionKey="";
    for(const id of aliases){
      try{
        partitionKey=tenantStudentPartition(schoolId,id);
        entity=await table("tenantPractice").getEntity(partitionKey,practiceId);
        break;
      }catch(e){if(e.statusCode!==404)throw e}
    }
    if(!entity)return json({error:"找不到自主練習紀錄，可能已被移除"},404);
    await table("tenantPractice").deleteEntity(partitionKey,practiceId);
    return json({ok:true,practiceId,studentId,deletedAt:new Date().toISOString(),deletedBy:a.email});
  }

  if(a.role!=="parent"&&a.role!=="admin")return json({error:"此角色不可新增自主練習"},403);
  const body=await request.json();
  if(!body.studentId||!ensureStudentAccess(a,body.studentId))return json({error:"Forbidden"},403);
  const minutes=minutesBetween(body.startTime,body.endTime);
  if(minutes<=0||minutes>240)return json({error:"練習時間不合法"},400);
  if(body.parentConfirmed!==true)return json({error:"需要家長確認"},400);
  const aliases=await getStudentIdAliases(body.studentId,schoolId),canonicalStudentId=aliases[0]||String(body.studentId);
  await ensureTenantTables();
  await table("tenantPractice").createEntity({
    partitionKey:tenantStudentPartition(schoolId,canonicalStudentId),rowKey:rowKey("p"),schoolId,studentId:canonicalStudentId,eventDate:body.practiceDate,
    startTime:body.startTime,endTime:body.endTime,minutes,qualified:minutes>=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15),
    practiceContent:String(body.practiceContent||"").slice(0,500),focus:String(body.focus||"").slice(0,100),
    confirmed:true,createdBy:a.email,createdAt:new Date().toISOString()
  });
  return json({ok:true,studentId:canonicalStudentId,minutes,qualified:minutes>=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15)},201);
}});
