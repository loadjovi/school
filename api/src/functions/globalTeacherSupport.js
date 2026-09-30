import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTenantTables,table,rowKey,tenantIdValue,listTenantDirectory,getTenantDirectory,listTeacherDirectory,getTeacherDirectory,listTeacherSupport,listGlobalTeacherEvents,writeGlobalAudit } from "../lib/storage.js";

const clean=(value,max=200)=>String(value??"").trim().slice(0,max);
const email=value=>clean(value,320).toLowerCase();
const day=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const time=()=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date());
const dateOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;
const timeOk=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const mins=v=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
const groups=new Set(["A","B","儲備"]),sections=new Set(["小提一部","小提二部","中提","大提","低音提"]),courses=new Set(["section","ensemble","comprehensive","practice"]);
const participants=x=>{try{const v=JSON.parse(String(x||"[]"));return Array.isArray(v)?v:[]}catch{return []}};
const supportView=x=>({assignmentId:x.rowKey,sourceSchoolId:x.sourceSchoolId,targetSchoolId:x.schoolId,teacherEmail:x.teacherEmail,teacherName:x.teacherName,courseType:x.courseType,groupName:x.groupName,section:x.section,startDate:x.startDate,endDate:x.endDate,reason:x.reason,status:x.status,createdAt:x.createdAt,revokedAt:x.revokedAt||""});
const eventView=x=>({eventId:x.rowKey,title:x.title,eventDate:x.eventDate,startTime:x.startTime,endTime:x.endTime,location:x.location,note:x.note,status:x.status,participants:participants(x.participants),confirmedAt:x.confirmedAt||"",cancelledAt:x.cancelledAt||""});

app.http("globalTeacherSupport",{methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"global-teacher-support",handler:async request=>{
  const a=await getAccess(request);
  if(!a.authenticated)return json({error:"Unauthorized"},401);
  if(a.role!=="globalAdmin"||a.capabilities?.globalAdmin!==true)return json({error:"僅 Global 管理員可協調跨校師資"},403);
  await ensureTenantTables();
  if(request.method==="GET"){
    const schools=await Promise.all((await listTenantDirectory()).map(async s=>{
      const schoolId=String(s.rowKey||s.schoolId||""),[teachers,assignments]=await Promise.all([listTeacherDirectory(schoolId),listTeacherSupport(schoolId)]);
      return {schoolId,schoolName:s.schoolName||schoolId,status:s.status,teachers:teachers.map(t=>({email:t.teacherEmail||t.rowKey,teacherName:t.teacherName||"",status:t.status||"active"})),assignments:assignments.map(supportView)};
    }));
    return json({schools,events:(await listGlobalTeacherEvents()).map(eventView),today:day()});
  }
  let body;try{body=await request.json()}catch{return json({error:"JSON 格式不正確"},400)}
  const action=clean(body?.action,40),actor=a.email;
  if(request.method==="POST"&&action==="assign"){
    const sourceSchoolId=tenantIdValue(body.sourceSchoolId),targetSchoolId=tenantIdValue(body.targetSchoolId),teacherEmail=email(body.teacherEmail);
    const courseType=clean(body.courseType,24),groupName=clean(body.groupName,20),section=clean(body.section,40),startDate=clean(body.startDate,10),endDate=clean(body.endDate,10),reason=clean(body.reason,180);
    if(!sourceSchoolId||!targetSchoolId||sourceSchoolId===targetSchoolId||!courses.has(courseType))return json({error:"請選擇來源學校、支援學校及課別"},400);
    if(!dateOk(startDate)||!dateOk(endDate)||startDate>endDate||startDate<day()||(Date.parse(endDate)-Date.parse(startDate))/86400000>30)return json({error:"支援期間需從今天起，最長 31 天"},400);
    if((["practice","comprehensive"].includes(courseType)?groupName!=="ALL":!groups.has(groupName))||courseType==="ensemble"&&groupName==="儲備"||courseType==="section"&&!sections.has(section))return json({error:"請確認代課團別與分部"},400);
    if(reason.length<2)return json({error:"請填寫代課原因"},400);
    const [source,target,teacher,existingTeacher]=await Promise.all([getTenantDirectory(sourceSchoolId),getTenantDirectory(targetSchoolId),getTeacherDirectory(teacherEmail,sourceSchoolId),getTeacherDirectory(teacherEmail,targetSchoolId)]);
    if(!source||!target||!["active","onboarding"].includes(source.status)||!["active","onboarding"].includes(target.status))return json({error:"來源與支援學校都必須啟用"},400);
    if(teacher?.status!=="active")return json({error:"來源學校沒有啟用中的老師"},400);
    if(existingTeacher)return json({error:"目標學校已有此老師帳號，請由學校管理員維護"},409);
    const existing=(await listTeacherSupport(targetSchoolId,startDate,endDate)).filter(x=>x.status==="active");
    if(existing.some(x=>email(x.teacherEmail)===teacherEmail))return json({error:"此老師已有重疊的支援期間"},409);
    if(existing.some(x=>x.courseType===courseType&&x.groupName===groupName&&(courseType!=="section"||x.section===section)))return json({error:"同課別與團別已有代課老師"},409);
    const entity={partitionKey:targetSchoolId,rowKey:rowKey("support"),schoolId:targetSchoolId,sourceSchoolId,teacherEmail,teacherName:teacher.teacherName||teacherEmail,courseType,groupName,section:courseType==="section"?section:"",startDate,endDate,reason,status:"active",createdAt:new Date().toISOString(),createdBy:actor,revokedAt:"",revokedBy:""};
    await table("tenantTeacherSupport").createEntity(entity);
    await writeGlobalAudit({actorEmail:actor,action:"temporary_teacher_assign",schoolId:targetSchoolId,targetEmail:teacherEmail,details:{assignmentId:entity.rowKey,sourceSchoolId,courseType,groupName,section:entity.section,startDate,endDate,reason}});
    return json({ok:true,item:supportView(entity)},201);
  }
  if(request.method==="PATCH"&&action==="revokeAssignment"){
    const schoolId=tenantIdValue(body.targetSchoolId),id=clean(body.assignmentId,160);if(!schoolId||!id)return json({error:"缺少指派 ID"},400);
    let old;try{old=await table("tenantTeacherSupport").getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return json({error:"找不到指派"},404);throw e}
    if(old.status!=="active")return json({error:"指派已取消"},409);
    const revokedAt=new Date().toISOString();await table("tenantTeacherSupport").updateEntity({partitionKey:schoolId,rowKey:id,status:"revoked",revokedAt,revokedBy:actor},"Merge");
    await writeGlobalAudit({actorEmail:actor,action:"temporary_teacher_revoke",schoolId,targetEmail:old.teacherEmail,details:{assignmentId:id}});
    return json({ok:true,item:supportView({...old,status:"revoked",revokedAt})});
  }
  if(request.method==="POST"&&action==="createEvent"){
    const title=clean(body.title,120),eventDate=clean(body.eventDate,10),startTime=clean(body.startTime,5),endTime=clean(body.endTime,5),location=clean(body.location,120),note=clean(body.note,300);
    if(title.length<2||!dateOk(eventDate)||!timeOk(startTime)||!timeOk(endTime)||mins(endTime)<=mins(startTime)||mins(endTime)-mins(startTime)>600)return json({error:"請填寫展演名稱、日期和正確時段（最多 10 小時）"},400);
    if(eventDate<new Date(Date.now()-90*86400000).toISOString().slice(0,10))return json({error:"僅能補登最近 90 天的展演"},400);
    const refs=Array.isArray(body.participants)?body.participants:[];if(!refs.length||refs.length>100)return json({error:"請勾選 1 至 100 位老師"},400);
    const seen=new Set(),members=[];
    for(const ref of refs){
      const schoolId=tenantIdValue(ref.schoolId),teacherEmail=email(ref.email);
      if(!schoolId||!teacherEmail||seen.has(teacherEmail))return json({error:"老師重複或所屬學校無效"},400);
      seen.add(teacherEmail);
      const [school,teacher]=await Promise.all([getTenantDirectory(schoolId),getTeacherDirectory(teacherEmail,schoolId)]);
      if(!school||!["active","onboarding"].includes(school.status)||teacher?.status!=="active")return json({error:"參與老師需屬於已啟用的學校"},400);
      members.push({schoolId,email:teacherEmail,teacherName:teacher.teacherName||teacherEmail,minutes:0});
    }
    if((await listGlobalTeacherEvents(eventDate,eventDate)).some(e=>e.status!=="cancelled"&&startTime<e.endTime&&endTime>e.startTime&&participants(e.participants).some(p=>seen.has(p.email))))return json({error:"老師同時段已有展演活動"},409);
    const entity={partitionKey:"EVENT",rowKey:rowKey("event"),title,eventDate,startTime,endTime,location,note,status:"planned",participants:JSON.stringify(members),createdAt:new Date().toISOString(),createdBy:actor,confirmedAt:"",confirmedBy:"",cancelledAt:"",cancelledBy:""};
    await table("globalTeacherEvent").createEntity(entity);
    await writeGlobalAudit({actorEmail:actor,action:"global_teacher_event_create",details:{eventId:entity.rowKey,title,eventDate,teacherCount:members.length}});
    return json({ok:true,item:eventView(entity)},201);
  }
  if(request.method==="PATCH"&&["confirmEvent","cancelEvent"].includes(action)){
    const id=clean(body.eventId,160);if(!id)return json({error:"缺少活動 ID"},400);
    let old;try{old=await table("globalTeacherEvent").getEntity("EVENT",id)}catch(e){if(e.statusCode===404)return json({error:"找不到活動"},404);throw e}
    if(old.status==="cancelled")return json({error:"活動已取消"},409);
    const now=new Date().toISOString();
    if(action==="confirmEvent"){
      if(old.status!=="planned")return json({error:"工時已確認"},409);
      if(old.eventDate>day()||old.eventDate===day()&&old.endTime>time())return json({error:"活動結束後才能確認工時"},400);
      const members=participants(old.participants),submitted=Array.isArray(body.minutesByTeacher)?body.minutesByTeacher:[],byEmail=new Map(submitted.map(x=>[email(x.email),Number(x.minutes)]));
      if(submitted.length!==members.length||byEmail.size!==members.length||members.some(p=>!Number.isInteger(byEmail.get(p.email))||byEmail.get(p.email)<1||byEmail.get(p.email)>600))return json({error:"請逐位填寫 1 至 600 分鐘實際時間"},400);
      const confirmed=members.map(p=>({...p,minutes:byEmail.get(p.email)}));
      await table("globalTeacherEvent").updateEntity({partitionKey:"EVENT",rowKey:id,status:"confirmed",participants:JSON.stringify(confirmed),confirmedAt:now,confirmedBy:actor},"Merge");
      await writeGlobalAudit({actorEmail:actor,action:"global_teacher_event_confirm",details:{eventId:id,participants:confirmed.map(p=>({schoolId:p.schoolId,email:p.email,minutes:p.minutes}))}});
      return json({ok:true,item:eventView({...old,status:"confirmed",participants:JSON.stringify(confirmed),confirmedAt:now})});
    }
    await table("globalTeacherEvent").updateEntity({partitionKey:"EVENT",rowKey:id,status:"cancelled",cancelledAt:now,cancelledBy:actor},"Merge");
    await writeGlobalAudit({actorEmail:actor,action:"global_teacher_event_cancel",details:{eventId:id,previousStatus:old.status}});
    return json({ok:true,item:eventView({...old,status:"cancelled",cancelledAt:now})});
  }
  return json({error:"不支援的操作"},400);
}});
