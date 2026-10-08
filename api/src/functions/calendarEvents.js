import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantSchoolPartition, rowKey, listTeacherDirectory, listTeacherSupport, teacherForDate } from "../lib/storage.js";
import { auditSaved } from "../lib/adminAudit.js";

const safe=v=>String(v||"").replaceAll("'","''");
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
const validTime=v=>!v||/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||""));
const normGroup=v=>String(v||"").trim().replace(/團$/,"");
async function hasTrainingAttendance(schoolId,eventId){
  const filter=`PartitionKey eq '${safe(tenantSchoolPartition(schoolId))}' and eventId eq '${safe(eventId)}'`;
  for await(const _ of table("tenantTrainingAttendance").listEntities({queryOptions:{filter}}))return true;
  return false;
}
const taipeiDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const legacySaturdayDates=new Set(["2026-10-03","2026-10-17","2026-11-07","2026-11-14"]);
export const needsTrainingAttendance=e=>e.requiresAttendance===true||(
  String(e.eventType||"")==="competition_training"&&String(e.title||"")==="A團比賽加練｜週六加練"&&legacySaturdayDates.has(String(e.eventDate||""))
);
const eventView=(e,internal=false)=>({
  eventId:String(e.rowKey||""),
  eventType:String(e.eventType||"general"),
  title:String(e.title||"活動"),
  eventDate:String(e.eventDate||""),
  startTime:String(e.startTime||""),
  endTime:String(e.endTime||""),
  timeLabel:String(e.timeLabel||""),
  targetGroups:String(e.targetGroups||""),
  teacherName:String(e.teacherName||""),
  location:String(e.location||""),
  note:String(e.note||""),
  requiresAttendance:needsTrainingAttendance(e),
  visibleToParents:e.visibleToParents!==false,
  status:String(e.status||"active"),
  updatedAt:String(e.updatedAt||""),
  ...(internal?{teacherEmail:String(e.teacherEmail||""),teachingTeacherEmail:String(e.teachingTeacherEmail||""),teachingTeacherName:String(e.teachingTeacherName||""),teachingMinutes:Number(e.teachingMinutes||0),teachingConfirmedAt:String(e.teachingConfirmedAt||""),teachingConfirmedBy:String(e.teachingConfirmedBy||"")}:{}),
});

export async function listCalendarEvents(schoolId,startDate="",endDate="",groupName="",includeInactive=false){
  await ensureTenantTables();
  const sid=tenantSchoolPartition(schoolId),parts=[`PartitionKey eq '${safe(sid)}'`];
  if(startDate)parts.push(`eventDate ge '${safe(startDate)}'`);
  if(endDate)parts.push(`eventDate le '${safe(endDate)}'`);
  const group=normGroup(groupName),items=[];
  for await(const e of table("tenantCalendarEvent").listEntities({queryOptions:{filter:parts.join(" and ")}})){
    if(!includeInactive&&String(e.status||"active")!=="active")continue;
    const target=String(e.targetGroups||"").split(",").map(normGroup).filter(Boolean);
    if(group&&target.length&&!target.includes("ALL")&&!target.includes(group))continue;
    items.push(eventView(e,includeInactive));
  }
  return items.sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.startTime.localeCompare(b.startTime)||a.title.localeCompare(b.title,"zh-Hant"));
}

export async function calendarEventsForStudent(schoolId,startDate,endDate,student){
  const group=String(student?.groupName||"");
  const rows=await listCalendarEvents(schoolId,startDate,endDate,group,false);
  return rows.filter(x=>x.visibleToParents!==false);
}

function makePresetRows(){
  const early=["2026-09-02","2026-09-03","2026-09-09","2026-09-10","2026-09-16","2026-09-17","2026-09-23","2026-09-24","2026-09-30","2026-10-07","2026-10-08","2026-10-15","2026-10-21","2026-10-22","2026-10-28","2026-10-29"];
  const sat=["2026-10-03","2026-10-17","2026-11-07","2026-11-14"];
  return [
    ...early.map(eventDate=>({eventType:"competition_training",title:"A團比賽加練｜早自習",eventDate,startTime:"07:50",endTime:"08:35",timeLabel:"早自習",targetGroups:"A",teacherName:"陳宣文老師",location:"聖家樓四樓團練教室",note:"比賽加強練習｜地點：聖家樓四樓團練教室",requiresAttendance:false,visibleToParents:true})),
    ...sat.map(eventDate=>({eventType:"competition_training",title:"A團比賽加練｜週六加練",eventDate,startTime:"09:00",endTime:"11:00",timeLabel:"09:00–11:00",targetGroups:"A",teacherName:"林逸旻老師",location:"聖家樓四樓團練教室",note:"比賽加強練習｜地點：聖家樓四樓團練教室",requiresAttendance:true,visibleToParents:true}))
  ];
}

app.http("calendarEvents",{methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"calendar-events",handler:async request=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  await ensureTenantTables();

  if(request.method==="GET"){
    const from=String(request.query.get("from")||""),to=String(request.query.get("to")||""),groupName=String(request.query.get("groupName")||"");
    const items=await listCalendarEvents(schoolId,from,to,groupName,a.role==="admin");
    let teachers;
    if(a.role==="admin"){
      const permanent=(await listTeacherDirectory(schoolId)).filter(x=>String(x.status||"active")==="active").map(x=>({email:String(x.teacherEmail||x.rowKey||""),teacherName:String(x.teacherName||x.rowKey||"")}));
      const support=(await listTeacherSupport(schoolId)).filter(x=>x.courseType==="practice"&&x.endDate>=new Date(Date.now()-180*86400000).toISOString().slice(0,10)).map(x=>({email:x.teacherEmail,teacherName:x.teacherName,temporary:true,startDate:x.startDate,endDate:x.endDate,status:x.status}));
      teachers=[...new Map([...permanent,...support].map(x=>[x.email,x])).values()];
    }
    return json({items,...(teachers?{teachers}:{})});
  }

  if(a.role!=="admin")return json({error:"僅學校管理員可維護行事曆"},403);
  const body=await request.json(),sid=tenantSchoolPartition(schoolId),now=new Date().toISOString(),client=table("tenantCalendarEvent");

  if(request.method==="POST"){
    const source=body.action==="preset_a_competition_2026"?makePresetRows():(Array.isArray(body.items)?body.items:[body]);
    const saved=[];
    for(const x of source){
      const eventDate=String(x.eventDate||""),startTime=String(x.startTime||""),endTime=String(x.endTime||"");
      if(!validDate(eventDate))return json({error:"活動日期需為 YYYY-MM-DD"},400);
      if(!validTime(startTime)||!validTime(endTime))return json({error:"活動時間需為 HH:mm"},400);
      const deterministic=body.action==="preset_a_competition_2026"
        ?("evt_"+Buffer.from([x.eventType,x.title,eventDate,startTime,endTime,x.targetGroups].join("|"),"utf8").toString("base64url").slice(0,220))
        :String(x.eventId||rowKey("evt"));
      const teacherEmail=String(x.teacherEmail||"").trim().toLowerCase();
      if(x.requiresAttendance===true&&String(x.eventType||"general")!=="competition_training")return json({error:"目前僅比賽加練支援獨立點名"},400);
      if(teacherEmail){const t=await teacherForDate(teacherEmail,schoolId,eventDate);if(!t||t.temporary&&t.courseType!=="practice")return json({error:"點名老師需在活動日期具備本校加練權限"},400)}
      const entity={partitionKey:sid,rowKey:deterministic,schoolId:sid,eventType:String(x.eventType||"general").slice(0,40),title:String(x.title||"活動").slice(0,120),eventDate,startTime,endTime,timeLabel:String(x.timeLabel||"").slice(0,60),targetGroups:String(x.targetGroups||"ALL").slice(0,80),teacherName:String(x.teacherName||"").slice(0,80),teacherEmail,location:String(x.location||"").slice(0,120),note:String(x.note||"").slice(0,300),requiresAttendance:x.requiresAttendance===true,visibleToParents:x.visibleToParents!==false,status:"active",updatedAt:now,updatedBy:a.email};
      let old=null;try{old=await client.getEntity(sid,deterministic)}catch(e){if(e.statusCode!==404)throw e}
      const sameTeachingPlan=old&&String(old.eventType)===entity.eventType&&String(old.eventDate)===eventDate&&String(old.startTime)===startTime&&String(old.endTime)===endTime&&String(old.teacherName||"")===entity.teacherName;
      if(old&&(String(old.eventDate||"")!==eventDate||String(old.targetGroups||"")!==entity.targetGroups||(needsTrainingAttendance(old)&&!needsTrainingAttendance(entity)))&&await hasTrainingAttendance(schoolId,deterministic))return json({error:"此場已有點名紀錄，不能更改日期、團別或關閉點名"},409);
      if(body.action==="preset_a_competition_2026"&&sameTeachingPlan)entity.teacherEmail=String(old.teacherEmail||"");
      if(old?.teachingConfirmedAt&&!sameTeachingPlan)return json({error:"此加練已確認工時，請先撤銷後再修改活動"},409);
      if(old?.teachingConfirmedAt&&sameTeachingPlan){
        for(const key of ["teachingTeacherEmail","teachingTeacherName","teachingMinutes","teachingConfirmedAt","teachingConfirmedBy"])entity[key]=old[key];
      }
      await client.upsertEntity(entity,"Replace");saved.push(eventView(entity,true));
      await auditSaved(schoolId,a.email,old?"calendar_event_update":"calendar_event_create",{eventId:deterministic,title:entity.title,eventDate,before:old?eventView(old,true):null,after:eventView(entity,true)});
    }
    return json({ok:true,count:saved.length,items:saved});
  }

  const eventId=String(body.eventId||"");
  if(!eventId)return json({error:"缺少活動 ID"},400);
  let old;try{old=await client.getEntity(sid,eventId)}catch(e){if(e.statusCode===404)return json({error:"找不到活動"},404);throw e}
  if(["confirmTeaching","revokeTeaching"].includes(String(body.action||""))){
    if(String(old.eventType||"")!=="competition_training")return json({error:"只有加練活動可認列老師工時"},400);
    if(body.action==="confirmTeaching"){
      const day=taipeiDate(),time=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
      if(String(old.status||"active")!=="active"||String(old.eventDate||"")>day||(String(old.eventDate||"")===day&&(!old.endTime||String(old.endTime)>time)))return json({error:"加練尚未結束或已取消，不能確認工時"},400);
      const email=String(body.teacherEmail||"").trim().toLowerCase(),minutes=Number(body.minutes);
      if(!email||!Number.isInteger(minutes)||minutes<1||minutes>600)return json({error:"請選擇老師並填寫 1 至 600 分鐘的實際授課時間"},400);
      const teacher=await teacherForDate(email,schoolId,String(old.eventDate||""),{historical:true});
      if(!teacher||teacher.temporary&&teacher.courseType!=="practice")return json({error:"授課老師需在活動日期具備本校加練權限"},400);
      const entity={...old,partitionKey:sid,rowKey:eventId,teachingTeacherEmail:email,teachingTeacherName:String(teacher.teacherName||email),teachingMinutes:minutes,teachingConfirmedAt:now,teachingConfirmedBy:a.email,updatedAt:now,updatedBy:a.email};
      await client.upsertEntity(entity,"Replace");await auditSaved(schoolId,a.email,"calendar_event_update",{eventId,title:entity.title,eventDate:entity.eventDate,action:"confirmTeaching",before:eventView(old,true),after:eventView(entity,true)});return json({ok:true,item:eventView(entity,true)});
    }
    const entity={...old,partitionKey:sid,rowKey:eventId,teachingTeacherEmail:"",teachingTeacherName:"",teachingMinutes:0,teachingConfirmedAt:"",teachingConfirmedBy:"",updatedAt:now,updatedBy:a.email};
    await client.upsertEntity(entity,"Replace");await auditSaved(schoolId,a.email,"calendar_event_update",{eventId,title:entity.title,eventDate:entity.eventDate,action:"revokeTeaching",before:eventView(old,true),after:eventView(entity,true)});return json({ok:true,item:eventView(entity,true)});
  }
  if(old.teachingConfirmedAt&&(["cancel","delete"].includes(String(body.action||""))||String(body.status||"active")!=="active"))return json({error:"請先撤銷加練工時確認，再取消或刪除活動"},409);
  if(body.action==="delete"){
    if(await hasTrainingAttendance(schoolId,eventId))return json({error:"此場已有點名紀錄，請保留活動並改為取消，以保存出勤歷史"},409);
    await client.deleteEntity(sid,eventId);await auditSaved(schoolId,a.email,"calendar_event_delete",{eventId,title:String(old.title||""),eventDate:String(old.eventDate||""),before:eventView(old,true)});return json({ok:true,deleted:true});
  }
  const status=body.action==="cancel"?"cancelled":body.action==="restore"?"active":String(body.status||old.status||"active");
  const teacherEmail=String(body.teacherEmail??old.teacherEmail??"").trim().toLowerCase();
  if(teacherEmail){const t=await teacherForDate(teacherEmail,schoolId,String(body.eventDate??old.eventDate??""));if(!t||t.temporary&&t.courseType!=="practice")return json({error:"點名老師需在活動日期具備本校加練權限"},400)}
  const entity={...old,partitionKey:sid,rowKey:eventId,status,title:String((body.title??old.title)||"").slice(0,120),eventDate:String((body.eventDate??old.eventDate)||""),startTime:String((body.startTime??old.startTime)||""),endTime:String((body.endTime??old.endTime)||""),timeLabel:String((body.timeLabel??old.timeLabel)||"").slice(0,60),targetGroups:String((body.targetGroups??old.targetGroups)||"ALL").slice(0,80),teacherName:String((body.teacherName??old.teacherName)||"").slice(0,80),teacherEmail,location:String((body.location??old.location)||"").slice(0,120),note:String((body.note??old.note)||"").slice(0,300),requiresAttendance:body.requiresAttendance??old.requiresAttendance??false,visibleToParents:body.visibleToParents??old.visibleToParents??true,updatedAt:now,updatedBy:a.email};
  if(!validDate(entity.eventDate)||!validTime(entity.startTime)||!validTime(entity.endTime))return json({error:"日期或時間格式不正確"},400);
  if(entity.requiresAttendance===true&&entity.eventType!=="competition_training")return json({error:"目前僅比賽加練支援獨立點名"},400);
  if((entity.eventDate!==old.eventDate||entity.targetGroups!==old.targetGroups||(needsTrainingAttendance(old)&&!needsTrainingAttendance(entity)))&&await hasTrainingAttendance(schoolId,eventId))return json({error:"此場已有點名紀錄，不能更改日期、團別或關閉點名"},409);
  if(old.teachingConfirmedAt&&["eventDate","startTime","endTime","teacherName"].some(key=>String(entity[key]||"")!==String(old[key]||"")))return json({error:"請先撤銷加練工時確認，再修改授課日期、時間或老師"},409);
  await client.upsertEntity(entity,"Replace");await auditSaved(schoolId,a.email,"calendar_event_update",{eventId,title:entity.title,eventDate:entity.eventDate,action:String(body.action||"edit"),before:eventView(old,true),after:eventView(entity,true)});return json({ok:true,item:eventView(entity,true)});
}});
