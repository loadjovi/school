import { app } from "@azure/functions";
import { getTenantContext, ensureSectionAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getStudentMaster, tenantStudentPartition, listActivityRange, activityStudentId } from "../lib/storage.js";
import { enforceScheduledCourse } from "./schoolSchedule.js";

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
      if(!sessionDate||!groupName||!section)return json({error:"缺少日期、團別或分部"},400);
      if(!ensureSectionAccess(a,{groupName,section}))return json({error:"無此分部課權限"},403);
      const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"section",groupName);
      if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
      const latest=new Map();
      for(const e of await listActivityRange("section",schoolId,"","",sessionDate)){
        if(String(e.classType||"section")!=="section")continue;
        if(String(e.groupName||"")!==groupName||String(e.section||"")!==section)continue;
        const id=activityStudentId(e);
        const old=latest.get(id);
        if(!old||String(e.createdAt||"")>=String(old.createdAt||""))latest.set(id,e);
      }
      return json({sessionDate,groupName,section,items:[...latest.values()].map(e=>({studentId:activityStudentId(e),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const sessionDate=String(body.sessionDate||"").trim();
    const requestedGroup=String(body.groupName||"").trim();
    const requestedSection=String(body.section||"").trim();
    if(!sessionDate||!requestedGroup||!requestedSection||!items.length)return json({error:"缺少日期、團別、分部或點名資料"},400);
    if(!ensureSectionAccess(a,{groupName:requestedGroup,section:requestedSection}))return json({error:"無此分部課權限"},403);
    const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"section",requestedGroup);
    if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);

    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId,schoolId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const section=String(master.section||"待確認");
      const groupName=String(master.groupName||"");
      const view={studentId:master.rowKey,groupName,section};
      if(groupName!==requestedGroup||section!==requestedSection||!ensureSectionAccess(a,view))return json({error:`無此分部課權限：${master.studentName}`},403);
      const oldRows=await existingRows(client,schoolId,item.studentId,sessionDate,groupName,section);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      await client.createEntity({partitionKey:tenantStudentPartition(schoolId,item.studentId),rowKey:rowKey("s"),schoolId,studentId:String(item.studentId),eventDate:sessionDate,section,groupName,status:String(item.status||"present"),minutes:Number(item.minutes||0),teacher:a.email,classType:"section",createdAt:now});
    }
    return json({ok:true,count:items.length,sessionDate,groupName:requestedGroup,section:requestedSection},200);
  }
});
