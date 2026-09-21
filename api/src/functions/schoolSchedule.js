import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantSchoolPartition, rowKey } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
const normGroup=v=>String(v||"").trim().replace(/團$/,"");
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
const validTime=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||""));
const scheduleKey=x=>{
  const raw=[
    String(x.courseType||"other"),
    String(x.groupName||""),
    String(x.recurrence||"weekly"),
    String(x.weekday??""),
    String(x.sessionDate||""),
    String(x.startDate||""),
    String(x.endDate||""),
    String(x.startTime||""),
    String(x.endTime||"")
  ].join("|");
  return "sch_"+Buffer.from(raw,"utf8").toString("base64url").slice(0,220);
};
const scheduleView=e=>({
  scheduleId:String(e.rowKey||""),courseType:String(e.courseType||""),courseName:String(e.courseName||""),
  groupName:String(e.groupName||""),section:String(e.section||""),recurrence:String(e.recurrence||"weekly"),
  weekday:Number(e.weekday||0),startDate:String(e.startDate||""),endDate:String(e.endDate||""),
  sessionDate:String(e.sessionDate||""),startTime:String(e.startTime||""),endTime:String(e.endTime||""),
  location:String(e.location||""),status:String(e.status||"active"),note:String(e.note||"")
});
const exceptionView=e=>({
  exceptionId:String(e.rowKey||""),scheduleId:String(e.scheduleId||""),sessionDate:String(e.sessionDate||""),
  status:String(e.status||"cancelled"),newDate:String(e.newDate||""),newStartTime:String(e.newStartTime||""),
  newEndTime:String(e.newEndTime||""),reason:String(e.reason||""),updatedAt:String(e.updatedAt||"")
});
async function getScheduleState(schoolId){
  const sid=tenantSchoolPartition(schoolId);
  try{
    const e=await table("tenantScheduleState").getEntity(sid,"current");
    return {status:String(e.status||"draft"),activatedAt:String(e.activatedAt||""),activatedBy:String(e.activatedBy||""),updatedAt:String(e.updatedAt||""),updatedBy:String(e.updatedBy||"")};
  }catch(e){
    if(e.statusCode!==404)throw e;
    return {status:"draft",activatedAt:"",activatedBy:"",updatedAt:"",updatedBy:""};
  }
}
async function saveScheduleState(schoolId,status,updatedBy){
  const sid=tenantSchoolPartition(schoolId),now=new Date().toISOString(),old=await getScheduleState(schoolId);
  const entity={partitionKey:sid,rowKey:"current",schoolId:sid,status:status==="active"?"active":"draft",activatedAt:status==="active"?(old.activatedAt||now):"",activatedBy:status==="active"?(old.activatedBy||String(updatedBy||"")):"",updatedAt:now,updatedBy:String(updatedBy||"")};
  await table("tenantScheduleState").upsertEntity(entity,"Replace");
  return {status:entity.status,activatedAt:entity.activatedAt,activatedBy:entity.activatedBy,updatedAt:entity.updatedAt,updatedBy:entity.updatedBy};
}
async function listSchedules(schoolId){
  const sid=tenantSchoolPartition(schoolId),items=[];
  for await(const e of table("tenantSchedule").listEntities({queryOptions:{filter:`PartitionKey eq '${safe(sid)}'`}}))items.push(scheduleView(e));
  return items.sort((a,b)=>(a.startDate||a.sessionDate).localeCompare(b.startDate||b.sessionDate)||a.startTime.localeCompare(b.startTime));
}
async function listExceptions(schoolId,date=""){
  const sid=tenantSchoolPartition(schoolId),parts=[`PartitionKey eq '${safe(sid)}'`];
  if(date)parts.push(`sessionDate eq '${safe(date)}'`);
  const items=[];for await(const e of table("tenantScheduleException").listEntities({queryOptions:{filter:parts.join(" and ")}}))items.push(exceptionView(e));
  return items;
}
export async function resolveSchoolCourses(schoolId,date,student=null,options={}){
  await ensureTenantTables();
  const state=await getScheduleState(schoolId);
  if(state.status!=="active"&&!options.includeDraft)return [];
  const schedules=await listSchedules(schoolId),exceptions=await listExceptions(schoolId,date);
  const exMap=new Map(exceptions.map(x=>[`${x.scheduleId}|${x.sessionDate}`,x]));
  const weekday=new Date(date+"T12:00:00+08:00").getDay(),group=normGroup(student?.groupName||"");
  const result=[];
  for(const s of schedules){
    if(s.status!=="active")continue;
    const scheduled=s.recurrence==="date"?s.sessionDate===date:(s.weekday===weekday&&(!s.startDate||date>=s.startDate)&&(!s.endDate||date<=s.endDate));
    if(!scheduled)continue;
    const target=normGroup(s.groupName);
    if(student&&target&&target!=="ALL"&&!target.split(",").map(normGroup).includes(group))continue;
    const ex=exMap.get(`${s.scheduleId}|${date}`);
    result.push({...s,sessionDate:date,exception:ex||null,effectiveStatus:ex?.status||"active"});
  }
  return result;
}
export async function enforceScheduledCourse(schoolId,date,courseType,groupName=""){
  await ensureTenantTables();
  const state=await getScheduleState(schoolId);
  if(state.status!=="active")return {enforced:false,allowed:true,state};
  const courses=await resolveSchoolCourses(schoolId,date,null,{includeDraft:true});
  const group=normGroup(groupName);
  const candidates=courses.filter(x=>{
    if(String(x.courseType||"")!==String(courseType||""))return false;
    const target=normGroup(x.groupName);
    if(!group||!target||target==="ALL")return true;
    return target.split(",").map(normGroup).includes(group);
  });
  if(!candidates.length)return {enforced:true,allowed:false,state,reason:"此日期不是已啟用課表的上課日"};
  const available=candidates.find(x=>!["cancelled","rescheduled"].includes(String(x.effectiveStatus||"active")));
  if(available)return {enforced:true,allowed:true,state,course:available};
  const cancelled=candidates.find(x=>String(x.effectiveStatus||"")==="cancelled");
  if(cancelled)return {enforced:true,allowed:false,state,reason:cancelled.exception?.reason?("本課程已停課："+cancelled.exception.reason):"本課程已停課"};
  return {enforced:true,allowed:false,state,reason:"本課程已改期，原日期不可點名"};
}
app.http("schoolSchedule",{methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"school-schedule",handler:async(request)=>{
  const context=await getTenantContext(request);if(context.error)return context.error;const {access:a,schoolId}=context;
  await ensureTenantTables();
  if(request.method==="GET"){
    const date=String(request.query.get("date")||"").trim(),preview=String(request.query.get("preview")||"")==="1";
    const scheduleState=await getScheduleState(schoolId);
    if(date){
      const includeDraft=preview&&a.role==="admin";
      return json({date,scheduleState,items:await resolveSchoolCourses(schoolId,date,null,{includeDraft})});
    }
    return json({scheduleState,items:await listSchedules(schoolId),exceptions:await listExceptions(schoolId)});
  }
  if(a.role!=="admin")return json({error:"僅學校管理員可維護課表"},403);
  const body=await request.json(),sid=tenantSchoolPartition(schoolId),now=new Date().toISOString();
  if(request.method==="POST"){
    const rows=Array.isArray(body.items)?body.items:[body],prepared=[];
    try{
      for(const x of rows){
        const recurrence=x.recurrence==="date"?"date":"weekly",startTime=String(x.startTime||""),endTime=String(x.endTime||"");
        if(!validTime(startTime)||!validTime(endTime))return json({error:"時間格式需為 HH:mm"},400);
        if(recurrence==="date"&&!validDate(x.sessionDate))return json({error:"指定日期課程需提供 YYYY-MM-DD"},400);
        if(recurrence==="weekly"&&(!Number.isInteger(Number(x.weekday))||Number(x.weekday)<0||Number(x.weekday)>6))return json({error:"每週課程需提供 weekday 0-6"},400);
        const normalized={...x,recurrence,startTime,endTime};
        const id=String(x.scheduleId||scheduleKey(normalized));
        prepared.push({partitionKey:sid,rowKey:id,schoolId:sid,courseType:String(x.courseType||"other"),courseName:String(x.courseName||"課程").slice(0,100),groupName:String(x.groupName||"").slice(0,40),section:String(x.section||"").slice(0,60),recurrence,weekday:Number(x.weekday||0),startDate:String(x.startDate||""),endDate:String(x.endDate||""),sessionDate:String(x.sessionDate||""),startTime,endTime,location:String(x.location||"").slice(0,200),status:x.status==="inactive"?"inactive":"active",note:String(x.note||"").slice(0,300),updatedAt:now,updatedBy:a.email});
      }

      const scheduleClient=table("tenantSchedule"),exceptionClient=table("tenantScheduleException");
      const replacing=String(body.mode||"")==="replace";
      let oldSchedules=[],oldExceptions=[];
      if(replacing){
        for await(const e of scheduleClient.listEntities({queryOptions:{filter:`PartitionKey eq '${safe(sid)}'`}}))oldSchedules.push({partitionKey:e.partitionKey,rowKey:e.rowKey});
        for await(const e of exceptionClient.listEntities({queryOptions:{filter:`PartitionKey eq '${safe(sid)}'`}}))oldExceptions.push({partitionKey:e.partitionKey,rowKey:e.rowKey});
      }

      for(const entity of prepared)await scheduleClient.upsertEntity(entity,"Replace");

      if(replacing){
        const keep=new Set(prepared.map(x=>x.rowKey));
        for(const e of oldSchedules){
          if(keep.has(String(e.rowKey)))continue;
          try{await scheduleClient.deleteEntity(e.partitionKey,e.rowKey)}catch(err){if(err.statusCode!==404)throw err}
        }
        for(const e of oldExceptions){
          try{await exceptionClient.deleteEntity(e.partitionKey,e.rowKey)}catch(err){if(err.statusCode!==404)throw err}
        }
      }

      const scheduleState=await saveScheduleState(schoolId,"draft",a.email);
      return json({ok:true,count:prepared.length,mode:replacing?"replace":"append",scheduleState,items:prepared.map(scheduleView)});
    }catch(e){
      console.error("school schedule import failed",{schoolId:sid,mode:String(body.mode||"append"),count:rows.length,error:e?.message||String(e),statusCode:e?.statusCode||0});
      return json({error:"課表匯入失敗："+String(e?.message||e||"未知錯誤")},500);
    }
  }
  if(body.action==="activate"){
    const active=(await listSchedules(schoolId)).filter(x=>x.status==="active");
    if(!active.length)return json({error:"目前沒有可啟用的課程規則，請先匯入課表"},400);
    const scheduleState=await saveScheduleState(schoolId,"active",a.email);
    return json({ok:true,scheduleState,count:active.length});
  }
  if(body.action==="draft"){
    const scheduleState=await saveScheduleState(schoolId,"draft",a.email);
    return json({ok:true,scheduleState});
  }
  if(body.action==="exception"){
    const scheduleId=String(body.scheduleId||""),sessionDate=String(body.sessionDate||"");
    if(!scheduleId||!validDate(sessionDate))return json({error:"缺少課程或日期"},400);
    let source;
    try{source=scheduleView(await table("tenantSchedule").getEntity(sid,scheduleId))}catch(e){if(e.statusCode===404)return json({error:"找不到指定課程"},404);throw e}
    const weekday=new Date(sessionDate+"T12:00:00+08:00").getDay();
    const scheduled=source.recurrence==="date"
      ?source.sessionDate===sessionDate
      :(source.weekday===weekday&&(!source.startDate||sessionDate>=source.startDate)&&(!source.endDate||sessionDate<=source.endDate));
    if(!scheduled)return json({error:"所選日期不是此課程的上課日，請重新選擇日期"},400);
    const key=`${scheduleId}|${sessionDate}`,entity={partitionKey:sid,rowKey:key,schoolId:sid,scheduleId,sessionDate,status:["cancelled","rescheduled","active"].includes(body.status)?body.status:"cancelled",newDate:String(body.newDate||""),newStartTime:String(body.newStartTime||""),newEndTime:String(body.newEndTime||""),reason:String(body.reason||"").slice(0,300),updatedAt:now,updatedBy:a.email};
    await table("tenantScheduleException").upsertEntity(entity,"Replace");return json({ok:true,item:exceptionView(entity)});
  }
  return json({error:"不支援的異動"},400);
}});

export { listSchedules, listExceptions, getScheduleState };
