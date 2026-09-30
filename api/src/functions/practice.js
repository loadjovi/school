import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, getStudentIdAliases, json } from "../lib/auth.js";
import { ensureTenantTables, table, listByStudent, tenantStudentPartition, activityStudentId } from "../lib/storage.js";
import { groupPracticeRows, practiceSessionKey, practiceSessionId } from "../lib/practiceRecords.js";
function minutesBetween(start,end){
  const [sh,sm]=String(start||"").split(":").map(Number),[eh,em]=String(end||"").split(":").map(Number);
  if([sh,sm,eh,em].some(Number.isNaN))return -1;
  let m=(eh*60+em)-(sh*60+sm);if(m<0)m+=1440;return m;
}
function partitionStudentId(row){const partition=String(row.partitionKey||""),marker="|student|",index=partition.indexOf(marker);return index>=0?partition.slice(index+marker.length):""}
app.http("practice",{methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"practice",handler:async(request)=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  if(request.method==="GET"){
    const studentId=request.query.get("studentId"),month=request.query.get("month");
    if(!studentId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
    const start=month?`${month}-01`:null;
    const end=month?`${month}-31`:null;
    const aliases=await getStudentIdAliases(studentId,schoolId);
    const groups=groupPracticeRows((await Promise.all(aliases.map(id=>listByStudent("practice",id,start,end,schoolId)))).flat())
      .sort((a,b)=>String(b.record.eventDate||"").localeCompare(String(a.record.eventDate||""))||String(b.record.createdAt||"").localeCompare(String(a.record.createdAt||"")));
    return json({items:groups.map(({record:x,duplicates})=>({practiceId:String(x.rowKey||""),studentId:activityStudentId(x),sourceStudentId:partitionStudentId(x),practiceDate:x.eventDate,startTime:x.startTime,endTime:x.endTime,minutes:x.minutes,qualified:x.qualified,practiceContent:x.practiceContent,focus:x.focus,createdBy:String(x.createdBy||""),createdAt:String(x.createdAt||""),duplicateRecords:duplicates.map(r=>({practiceId:String(r.rowKey||""),sourceStudentId:partitionStudentId(r)})).filter(r=>r.practiceId&&r.sourceStudentId)}))});
  }

  if(request.method==="DELETE"){
    if(a.role!=="parent"&&a.role!=="admin")return json({error:"此角色不可刪除自主練習"},403);
    const body=await request.json();
    const studentId=String(body.studentId||"").trim(),practiceId=String(body.practiceId||"").trim(),sourceStudentId=String(body.sourceStudentId||"").trim();
    if(!studentId||!practiceId||!ensureStudentAccess(a,studentId))return json({error:"Forbidden"},403);
    const aliases=await getStudentIdAliases(studentId,schoolId);
    if(sourceStudentId&&!aliases.includes(sourceStudentId))return json({error:"Forbidden"},403);
    let entity=null,partitionKey="";
    for(const id of sourceStudentId?[sourceStudentId]:aliases){
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
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.practiceDate||"")))return json({error:"練習日期不合法"},400);
  const aliases=await getStudentIdAliases(body.studentId,schoolId),canonicalStudentId=aliases[0]||String(body.studentId);
  const sessionKey=practiceSessionKey(body);
  const existing=(await Promise.all(aliases.map(id=>listByStudent("practice",id,body.practiceDate,body.practiceDate,schoolId)))).flat()
    .find(x=>practiceSessionKey(x)===sessionKey);
  if(existing)return json({ok:true,duplicate:true,practiceId:existing.rowKey,studentId:canonicalStudentId,minutes:existing.minutes,qualified:existing.qualified});
  const practiceId=practiceSessionId(schoolId,canonicalStudentId,body);
  const qualified=minutes>=Number(process.env.PRACTICE_QUALIFIED_MINUTES||15);
  await ensureTenantTables();
  try{
    await table("tenantPractice").createEntity({
      partitionKey:tenantStudentPartition(schoolId,canonicalStudentId),rowKey:practiceId,schoolId,studentId:canonicalStudentId,eventDate:body.practiceDate,
      startTime:body.startTime,endTime:body.endTime,minutes,qualified,
      practiceContent:String(body.practiceContent||"").slice(0,500),focus:String(body.focus||"").slice(0,100),
      confirmed:true,createdBy:a.email,createdAt:new Date().toISOString()
    });
  }catch(e){if(e.statusCode!==409)throw e;return json({ok:true,duplicate:true,practiceId,studentId:canonicalStudentId,minutes,qualified})}
  return json({ok:true,practiceId,studentId:canonicalStudentId,minutes,qualified},201);
}});
