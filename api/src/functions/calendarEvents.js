import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantSchoolPartition, rowKey } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
const validTime=v=>!v||/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||""));
const normGroup=v=>String(v||"").trim().replace(/團$/,"");
const eventView=e=>({
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
  requiresAttendance:e.requiresAttendance===true,
  visibleToParents:e.visibleToParents!==false,
  status:String(e.status||"active"),
  updatedAt:String(e.updatedAt||"")
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
    items.push(eventView(e));
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
    ...sat.map(eventDate=>({eventType:"competition_training",title:"A團比賽加練｜週六加練",eventDate,startTime:"09:00",endTime:"11:00",timeLabel:"09:00–11:00",targetGroups:"A",teacherName:"林逸旻老師",location:"聖家樓四樓團練教室",note:"比賽加強練習｜地點：聖家樓四樓團練教室",requiresAttendance:false,visibleToParents:true}))
  ];
}

app.http("calendarEvents",{methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"calendar-events",handler:async request=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  await ensureTenantTables();

  if(request.method==="GET"){
    const from=String(request.query.get("from")||""),to=String(request.query.get("to")||""),groupName=String(request.query.get("groupName")||"");
    return json({items:await listCalendarEvents(schoolId,from,to,groupName,a.role==="admin")});
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
      const entity={partitionKey:sid,rowKey:deterministic,schoolId:sid,eventType:String(x.eventType||"general").slice(0,40),title:String(x.title||"活動").slice(0,120),eventDate,startTime,endTime,timeLabel:String(x.timeLabel||"").slice(0,60),targetGroups:String(x.targetGroups||"ALL").slice(0,80),teacherName:String(x.teacherName||"").slice(0,80),location:String(x.location||"").slice(0,120),note:String(x.note||"").slice(0,300),requiresAttendance:x.requiresAttendance===true,visibleToParents:x.visibleToParents!==false,status:"active",updatedAt:now,updatedBy:a.email};
      await client.upsertEntity(entity,"Replace");saved.push(eventView(entity));
    }
    return json({ok:true,count:saved.length,items:saved});
  }

  const eventId=String(body.eventId||"");
  if(!eventId)return json({error:"缺少活動 ID"},400);
  let old;try{old=await client.getEntity(sid,eventId)}catch(e){if(e.statusCode===404)return json({error:"找不到活動"},404);throw e}
  if(body.action==="delete"){
    await client.deleteEntity(sid,eventId);return json({ok:true,deleted:true});
  }
  const status=body.action==="cancel"?"cancelled":body.action==="restore"?"active":String(body.status||old.status||"active");
  const entity={...old,partitionKey:sid,rowKey:eventId,status,title:String((body.title??old.title)||"").slice(0,120),eventDate:String((body.eventDate??old.eventDate)||""),startTime:String((body.startTime??old.startTime)||""),endTime:String((body.endTime??old.endTime)||""),timeLabel:String((body.timeLabel??old.timeLabel)||"").slice(0,60),targetGroups:String((body.targetGroups??old.targetGroups)||"ALL").slice(0,80),teacherName:String((body.teacherName??old.teacherName)||"").slice(0,80),location:String((body.location??old.location)||"").slice(0,120),note:String((body.note??old.note)||"").slice(0,300),requiresAttendance:body.requiresAttendance??old.requiresAttendance??false,visibleToParents:body.visibleToParents??old.visibleToParents??true,updatedAt:now,updatedBy:a.email};
  if(!validDate(entity.eventDate)||!validTime(entity.startTime)||!validTime(entity.endTime))return json({error:"日期或時間格式不正確"},400);
  await client.upsertEntity(entity,"Replace");return json({ok:true,item:eventView(entity)});
}});
