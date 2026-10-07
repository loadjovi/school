import { app } from "@azure/functions";
import { getTenantContext, ensureSectionAccess, ensureTemporaryCourseAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getStudentMaster, listStudentMaster, tenantStudentPartition, listActivityRange, activityStudentId } from "../lib/storage.js";
import { enforceScheduledCourse } from "./schoolSchedule.js";
import { listSectionMerges, receivingMerges, validMergeDate } from "../lib/sectionMerge.js";

const taipeiDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

const safe=v=>String(v||"").replaceAll("'","''");

async function existingRows(client,schoolId,studentId,sessionDate,groupName,section){
  const rows=[];
  const filter=`PartitionKey eq '${safe(tenantStudentPartition(schoolId,studentId))}' and eventDate eq '${safe(sessionDate)}'`;
  for await (const e of client.listEntities({queryOptions:{filter}})){
    if(String(e.classType||"section")!=="section")continue;
    if(String(e.groupName||"")!==String(groupName||""))continue;
    if(String(e.section||"")!==String(section||""))continue;
    rows.push(e);
  }
  return rows;
}

function mergeContext(merges,a,date,group,section){
  const active=merges.filter(x=>x.status==="active"&&x.sessionDate===date&&x.groupName===group);
  if(active.some(x=>x.sourceSection===section))return {error:"此分部當日已併入其他分部，請由接課老師在接課分部統一點名"};
  const received=a.role==="admin"?active.filter(x=>x.targetSection===section):receivingMerges(active,date,group,section,a.email);
  return {received};
}

async function rosterFor(schoolId,group,section,received){
  const sections=new Set([section,...received.map(x=>x.sourceSection)]);
  return (await listStudentMaster("active",schoolId)).filter(x=>x.groupName===group&&sections.has(String(x.section||"待確認"))).map(x=>({studentId:String(x.rowKey),name:String(x.studentName||""),grade:String(x.grade||""),groupName:String(x.groupName||""),section:String(x.section||"待確認"),instrument:String(x.instrument||"")}));
}

app.http("sectionAttendance",{
  methods:["GET","POST"],authLevel:"anonymous",route:"section-attendance",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(!(a.role==="admin"||a.capabilities?.section))return json({error:"Forbidden"},403);
    await ensureTenantTables();
    const client=table("tenantSection");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      const groupName=String(request.query.get("groupName")||"").trim();
      const section=String(request.query.get("section")||"").trim();
      if(!validMergeDate(sessionDate)||!groupName||!section)return json({error:"缺少有效日期、團別或分部"},400);
      if(!ensureTemporaryCourseAccess(a,"section",sessionDate))return json({error:"此日期不在短期代課期間"},403);
      if(!ensureSectionAccess(a,{groupName,section}))return json({error:"無此分部課權限"},403);
      const merge=mergeContext(await listSectionMerges(schoolId,sessionDate),a,sessionDate,groupName,section);
      if(merge.error)return json({error:merge.error},409);
      const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"section",groupName);
      if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
      const roster=await rosterFor(schoolId,groupName,section,merge.received),sections=new Set([section,...merge.received.map(x=>x.sourceSection)]);
      const latest=new Map();
      for(const e of await listActivityRange("section",schoolId,"","",sessionDate)){
        if(String(e.classType||"section")!=="section")continue;
        if(String(e.groupName||"")!==groupName||!sections.has(String(e.section||"")))continue;
        const id=activityStudentId(e);
        const old=latest.get(id);
        if(!old||String(e.createdAt||"")>=String(old.createdAt||""))latest.set(id,e);
      }
      const rows=[...latest.values()],last=rows.slice().sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||"")))[0];
      return json({sessionDate,groupName,section,roster,merges:merge.received,recordedBy:String(last?.teacherName||last?.teacher||""),recordedByEmail:String(last?.teacher||""),recordedByRole:String(last?.actorRole||"teacher"),lastSavedAt:String(last?.createdAt||""),items:rows.map(e=>({studentId:activityStudentId(e),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),teacherName:String(e.teacherName||e.teacher||""),actorRole:String(e.actorRole||"teacher"),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const sessionDate=String(body.sessionDate||"").trim();
    const requestedGroup=String(body.groupName||"").trim();
    const requestedSection=String(body.section||"").trim();
    if(!validMergeDate(sessionDate)||!requestedGroup||!requestedSection||!items.length)return json({error:"缺少有效日期、團別、分部或點名資料"},400);
    if(a.role!=="admin"&&sessionDate<taipeiDate())return json({error:"過去日期的分部課點名僅能由校方修正，請聯繫學校行政"},403);
    if(!ensureTemporaryCourseAccess(a,"section",sessionDate))return json({error:"此日期不在短期代課期間"},403);
    if(!ensureSectionAccess(a,{groupName:requestedGroup,section:requestedSection}))return json({error:"無此分部課權限"},403);
    const merge=mergeContext(await listSectionMerges(schoolId,sessionDate),a,sessionDate,requestedGroup,requestedSection);
    if(merge.error)return json({error:merge.error},409);
    const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"section",requestedGroup);
    if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);

    const now=new Date().toISOString(),roster=await rosterFor(schoolId,requestedGroup,requestedSection,merge.received);
    const allowed=new Map(roster.map(x=>[x.studentId,x]));
    if(items.some(x=>!allowed.has(String(x.studentId)))||new Set(items.map(x=>String(x.studentId))).size!==items.length)return json({error:"點名名單含不屬於本次併班的學生或重複學號"},403);
    const savedItems=[];
    for(const item of items){
      const master=await getStudentMaster(item.studentId,schoolId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const section=String(master.section||"待確認");
      const groupName=String(master.groupName||"");
      const view={studentId:master.rowKey,groupName,section};
      const sourceMerge=merge.received.find(x=>x.sourceSection===section);
      if(groupName!==requestedGroup||!(section===requestedSection&&ensureSectionAccess(a,view)||sourceMerge))return json({error:`無此分部課權限：${master.studentName}`},403);
      const oldRows=await existingRows(client,schoolId,item.studentId,sessionDate,groupName,section);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      const saved={studentId:String(item.studentId),status:String(item.status||"present"),minutes:Number(item.minutes||0),teacher:a.email,teacherName:String(a.displayName||a.email||""),actorRole:a.role==="admin"?"admin":"teacher",createdAt:now};
      await client.createEntity({partitionKey:tenantStudentPartition(schoolId,item.studentId),rowKey:rowKey("s"),schoolId,studentId:String(item.studentId),eventDate:sessionDate,section,groupName,...saved,classType:"section",...(sourceMerge?{mergeId:sourceMerge.mergeId,mergeTargetSection:requestedSection,mergeTeacherEmail:sourceMerge.receivingTeacherEmail,mergeTeacherName:sourceMerge.receivingTeacherName}:{})});
      savedItems.push(saved);
    }
    return json({ok:true,count:savedItems.length,sessionDate,groupName:requestedGroup,section:requestedSection,roster,merges:merge.received,recordedBy:String(a.displayName||a.email||""),recordedByEmail:String(a.email||""),recordedByRole:a.role==="admin"?"admin":"teacher",lastSavedAt:now,items:savedItems},200);
  }
});
