import { app } from "@azure/functions";
import { getTenantContext, ensureEnsembleAccess, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getStudentMaster, tenantStudentPartition, listActivityRange, activityStudentId } from "../lib/storage.js";
import { enforceScheduledCourse } from "./schoolSchedule.js";

const safe=v=>String(v||"").replaceAll("'","''");

async function existingRows(client,schoolId,studentId,sessionDate,groupName){
  const rows=[];
  const filter=`PartitionKey eq '${safe(tenantStudentPartition(schoolId,studentId))}' and eventDate eq '${safe(sessionDate)}'`;
  for await (const e of client.listEntities({queryOptions:{filter}})){
    if(String(e.classType||"ensemble")!=="ensemble")continue;
    if(String(e.groupName||"")!==String(groupName||""))continue;
    rows.push(e);
  }
  return rows;
}

app.http("ensembleAttendance",{
  methods:["GET","POST"],authLevel:"anonymous",route:"ensemble-attendance",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access:a,schoolId}=context;
    if(!(a.role==="admin"||a.capabilities?.ensemble))return json({error:"Forbidden"},403);
    await ensureTenantTables();
    const client=table("tenantEnsemble");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      const groupName=String(request.query.get("groupName")||"").trim();
      if(!sessionDate||!groupName)return json({error:"缺少日期或團別"},400);
      if(!["A","B"].includes(groupName)&&a.role!=="admin")return json({error:"目前團體課僅開放 A、B 團"},400);
      if(!ensureEnsembleAccess(a,{groupName}))return json({error:"無此團體課權限"},403);
      const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"ensemble",groupName);
      if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
      const latest=new Map();
      for(const e of await listActivityRange("ensemble",schoolId,"","",sessionDate)){
        if(String(e.classType||"ensemble")!=="ensemble")continue;
        if(String(e.groupName||"")!==groupName)continue;
        const id=activityStudentId(e);
        const old=latest.get(id);
        if(!old||String(e.createdAt||"")>=String(old.createdAt||""))latest.set(id,e);
      }
      const rows=[...latest.values()],last=rows.slice().sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||"")))[0];
      return json({sessionDate,groupName,recordedBy:String(last?.teacherName||last?.teacher||""),recordedByEmail:String(last?.teacher||""),recordedByRole:String(last?.actorRole||"teacher"),lastSavedAt:String(last?.createdAt||""),items:rows.map(e=>({studentId:activityStudentId(e),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),teacherName:String(e.teacherName||e.teacher||""),actorRole:String(e.actorRole||"teacher"),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const sessionDate=String(body.sessionDate||"").trim();
    const groupName=String(body.groupName||"").trim();
    if(!sessionDate||!groupName||!items.length)return json({error:"缺少團別、日期或點名資料"},400);
    if(!["A","B"].includes(groupName)&&a.role!=="admin")return json({error:"目前團體課僅開放 A、B 團"},400);
    if(!ensureEnsembleAccess(a,{groupName}))return json({error:"無此團體課權限"},403);
    const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"ensemble",groupName);
    if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId,schoolId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const view={studentId:master.rowKey,groupName:master.groupName,section:master.section||"待確認"};
      if(master.groupName!==groupName||!ensureEnsembleAccess(a,view))return json({error:`無此團體課權限：${master.studentName}`},403);
      const oldRows=await existingRows(client,schoolId,item.studentId,sessionDate,groupName);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      await client.createEntity({partitionKey:tenantStudentPartition(schoolId,item.studentId),rowKey:rowKey("e"),schoolId,studentId:String(item.studentId),eventDate:sessionDate,groupName:master.groupName,section:master.section||"待確認",status:String(item.status||"present"),minutes:Number(item.minutes||0),teacher:a.email,teacherName:String(a.displayName||a.email||""),actorRole:a.role==="admin"?"admin":"teacher",classType:"ensemble",createdAt:now});
    }
    return json({ok:true,count:items.length,sessionDate,groupName},200);
  }
});
