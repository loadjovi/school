import { app } from "@azure/functions";
import { getTenantContext, ensureTemporaryCourseAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, tenantSchoolPartition, listStudentMaster, listTeacherDirectory } from "../lib/storage.js";
import { needsTrainingAttendance } from "./calendarEvents.js";

const safe=v=>String(v||"").replaceAll("'","''");
const dateOk=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v||"")))return false;const d=new Date(`${v}T12:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v};
const taipeiDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const normName=v=>String(v||"").trim().replace(/老師$/ ,"").replace(/\s+/g,"");
const normGroup=v=>String(v||"").trim().replace(/團$/ ,"");
const allowedStatus=new Set(["present","late","leave","absent"]);
const recordKey=(eventId,studentId)=>"tr_"+Buffer.from(`${eventId}|${studentId}`,"utf8").toString("base64url");
const isTraining=e=>String(e.eventType||"")==="competition_training"&&needsTrainingAttendance(e);
const summary=e=>({eventId:String(e.rowKey||""),title:String(e.title||""),eventDate:String(e.eventDate||""),startTime:String(e.startTime||""),endTime:String(e.endTime||""),targetGroups:String(e.targetGroups||""),teacherName:String(e.teacherName||""),location:String(e.location||""),status:String(e.status||"active"),requiresAttendance:true});

function rosterFor(event,masters){
  const groups=String(event.targetGroups||"ALL").split(",").map(normGroup).filter(Boolean);
  return masters.filter(s=>String(s.status||"active")==="active"&&(!groups.length||groups.includes("ALL")||groups.includes(normGroup(s.groupName))));
}

function mayTakeAttendance(access,event,teachers){
  if(access.role==="admin")return true;
  if(!access.capabilities?.teacherSettings||String(event.status||"active")!=="active")return false;
  if(!ensureTemporaryCourseAccess(access,"practice",event.eventDate))return false;
  const email=String(access.email||"").trim().toLowerCase();
  const assigned=String(event.teacherEmail||"").trim().toLowerCase();
  if(assigned)return assigned===email;
  const named=normName(event.teacherName);
  const matches=teachers.filter(t=>String(t.status||"active")==="active"&&normName(t.teacherName)===named);
  return !!named&&matches.length===1&&String(matches[0].teacherEmail||matches[0].rowKey||"").toLowerCase()===email;
}

async function savedRecords(schoolId,eventId){
  const filter=`PartitionKey eq '${safe(tenantSchoolPartition(schoolId))}' and eventId eq '${safe(eventId)}'`,rows=[];
  for await(const e of table("tenantTrainingAttendance").listEntities({queryOptions:{filter}}))rows.push(e);
  return rows;
}

app.http("trainingAttendance",{methods:["GET","POST"],authLevel:"anonymous",route:"training-attendance",handler:async request=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access:a,schoolId}=context;
  if(a.role!=="admin"&&!a.capabilities?.teacherSettings)return json({error:"僅授課老師與學校管理員可使用加練點名"},403);
  await ensureTenantTables();
  const sid=tenantSchoolPartition(schoolId),eventsClient=table("tenantCalendarEvent");
  const teachers=a.role==="admin"?[]:await listTeacherDirectory(schoolId);

  if(request.method==="GET"&&!request.query.get("eventId")){
    const from=String(request.query.get("from")||taipeiDate()),to=String(request.query.get("to")||from);
    if(!dateOk(from)||!dateOk(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>370)return json({error:"日期區間須為 370 天以內"},400);
    const filter=`PartitionKey eq '${safe(sid)}' and eventDate ge '${safe(from)}' and eventDate le '${safe(to)}'`,items=[];
    for await(const e of eventsClient.listEntities({queryOptions:{filter}})){
      if(!isTraining(e)||!mayTakeAttendance(a,e,teachers))continue;
      items.push(summary(e));
    }
    const masters=await listStudentMaster("active",schoolId);
    const withProgress=await Promise.all(items.map(async x=>{
      const roster=rosterFor(x,masters),saved=await savedRecords(schoolId,x.eventId),active=new Set(roster.map(s=>String(s.rowKey)));
      return {...x,expected:roster.length,recorded:saved.filter(r=>active.has(String(r.studentId))&&allowedStatus.has(String(r.status))).length};
    }));
    return json({items:withProgress.sort((x,y)=>x.eventDate.localeCompare(y.eventDate)||x.startTime.localeCompare(y.startTime))});
  }

  const body=request.method==="POST"?await request.json():null;
  const eventId=String(body?.eventId||request.query.get("eventId")||"").trim();
  if(!eventId||eventId.length>500)return json({error:"缺少有效的加練活動 ID"},400);
  let event;try{event=await eventsClient.getEntity(sid,eventId)}catch(e){if(e.statusCode===404)return json({error:"找不到加練活動"},404);throw e}
  if(!isTraining(event))return json({error:"此場加練不需要點名"},400);
  if(!mayTakeAttendance(a,event,teachers))return json({error:"無此加練的點名權限，請由學校管理員指定授課老師 Gmail"},403);
  const masters=await listStudentMaster("active",schoolId),roster=rosterFor(event,masters);
  if(request.method==="GET"){
    const saved=await savedRecords(schoolId,eventId),byId=new Map(saved.map(x=>[String(x.studentId),x]));
    const items=roster.map(s=>{const r=byId.get(String(s.rowKey));return {studentId:String(s.rowKey),name:String(s.studentName||""),groupName:String(s.groupName||""),section:String(s.section||""),grade:String(s.grade||""),status:String(r?.status||""),updatedAt:String(r?.updatedAt||""),recordedBy:String(r?.recordedByName||r?.recordedBy||"")}});
    const last=saved.slice().sort((x,y)=>String(y.updatedAt||"").localeCompare(String(x.updatedAt||"")))[0];
    return json({event:summary(event),items,recorded:items.filter(x=>allowedStatus.has(x.status)).length,expected:items.length,lastSavedAt:String(last?.updatedAt||""),lastSavedBy:String(last?.recordedByName||last?.recordedBy||"")});
  }

  if(String(event.status||"active")!=="active")return json({error:"已取消的加練不可點名"},409);
  if(String(event.eventDate||"")>taipeiDate())return json({error:"加練日期未到，請於當天或之後點名"},409);
  const items=Array.isArray(body.items)?body.items:[];
  const expected=new Set(roster.map(x=>String(x.rowKey))),received=new Set();
  if(!expected.size)return json({error:"此場加練沒有符合團別的在籍學生"},400);
  if(items.length!==expected.size)return json({error:"請完成本場所有學生的點名"},400);
  for(const x of items){const id=String(x?.studentId||"");if(!expected.has(id)||received.has(id)||!allowedStatus.has(String(x?.status||"")))return json({error:"學生名單或出勤狀態不正確，請重新整理後再儲存"},400);received.add(id)}
  const statuses=new Map(items.map(x=>[String(x.studentId),String(x.status)])),now=new Date().toISOString();
  for(const s of roster){
    const studentId=String(s.rowKey);
    await table("tenantTrainingAttendance").upsertEntity({partitionKey:sid,rowKey:recordKey(eventId,studentId),schoolId:sid,eventId,eventDate:String(event.eventDate),studentId,studentName:String(s.studentName||""),groupName:String(s.groupName||""),section:String(s.section||""),status:statuses.get(studentId),recordedBy:String(a.email||""),recordedByName:String(a.displayName||a.email||""),updatedAt:now},"Replace");
  }
  return json({ok:true,recorded:roster.length,expected:roster.length,lastSavedAt:now});
}});
