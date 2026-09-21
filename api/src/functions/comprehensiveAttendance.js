import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getStudentMaster, getTeacherProfile, tenantStudentPartition, listActivityRange, activityStudentId } from "../lib/storage.js";
import { enforceScheduledCourse } from "./schoolSchedule.js";

const allowedGroups=new Set(["A","B","儲備"]);
const safe=v=>String(v||"").replaceAll("'","''");

async function canUse(access,schoolId){
  if(access.role==="admin")return true;
  if(!access.capabilities?.teacherSettings)return false;
  const p=await getTeacherProfile(access.email,schoolId);
  return p?.comprehensiveEnabled===true;
}

async function existingRows(client,schoolId,studentId,sessionDate){
  const rows=[];
  const filter=`PartitionKey eq '${safe(tenantStudentPartition(schoolId,studentId))}' and eventDate eq '${safe(sessionDate)}'`;
  for await (const e of client.listEntities({queryOptions:{filter}})){
    if(String(e.classType||"comprehensive")!=="comprehensive")continue;
    rows.push(e);
  }
  return rows;
}

app.http("comprehensiveAttendance",{
  methods:["GET","POST"],authLevel:"anonymous",route:"comprehensive-attendance",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(!(await canUse(access,schoolId)))return json({error:"尚未開啟綜合課點名權限"},403);
    await ensureTenantTables();
    const client=table("tenantComprehensive");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      if(!sessionDate)return json({error:"缺少上課日期"},400);
      const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"comprehensive");
      if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
      const latest=new Map();
      for(const e of await listActivityRange("comprehensive",schoolId,"","",sessionDate)){
        if(String(e.classType||"comprehensive")!=="comprehensive")continue;
        const id=activityStudentId(e);
        const old=latest.get(id);
        const stamp=`${String(e.createdAt||"")}|${String(e.rowKey||"")}`;
        const oldStamp=old?`${String(old.createdAt||"")}|${String(old.rowKey||"")}`:"";
        if(!old||stamp>=oldStamp)latest.set(id,e);
      }
      const rows=[...latest.values()],last=rows.slice().sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||"")))[0];
      return json({sessionDate,recordedBy:String(last?.teacherName||last?.teacher||""),recordedByEmail:String(last?.teacher||""),recordedByRole:String(last?.actorRole||"teacher"),lastSavedAt:String(last?.createdAt||""),items:rows.map(e=>({studentId:activityStudentId(e),groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),teacherName:String(e.teacherName||e.teacher||""),actorRole:String(e.actorRole||"teacher"),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const sessionDate=String(body.sessionDate||"").trim();
    const items=Array.isArray(body.items)?body.items:[];
    if(!sessionDate||!items.length)return json({error:"缺少日期或點名資料"},400);
    const schedulePolicy=await enforceScheduledCourse(schoolId,sessionDate,"comprehensive");
    if(schedulePolicy.enforced&&!schedulePolicy.allowed)return json({error:schedulePolicy.reason,scheduleBlocked:true},409);
    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId,schoolId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      if(master.status==="inactive"||!allowedGroups.has(String(master.groupName||"")))return json({error:`學生不在綜合課名單：${master.studentName}`},400);
      const oldRows=await existingRows(client,schoolId,item.studentId,sessionDate);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      const status=String(item.status||"present");
      await client.createEntity({
        partitionKey:tenantStudentPartition(schoolId,item.studentId),rowKey:rowKey("c"),schoolId,studentId:String(item.studentId),eventDate:sessionDate,
        groupName:String(master.groupName||""),section:String(master.section||"待確認"),
        status,minutes:Number(item.minutes??(["present","late"].includes(status)?90:0)),
        teacher:access.email,teacherName:String(access.displayName||access.email||""),actorRole:access.role==="admin"?"admin":"teacher",classType:"comprehensive",createdAt:now
      });
    }
    return json({ok:true,count:items.length,sessionDate},200);
  }
});
