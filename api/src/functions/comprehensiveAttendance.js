import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster, getTeacherProfile } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","儲備"]);
const safe=v=>String(v||"").replaceAll("'","''");

async function canUse(access){
  if(access.role==="admin")return true;
  if(!access.capabilities?.teacherSettings)return false;
  const p=await getTeacherProfile(access.email);
  return p?.comprehensiveEnabled===true;
}

async function existingRows(client,studentId,sessionDate){
  const rows=[];
  const filter=`PartitionKey eq '${safe(studentId)}' and eventDate eq '${safe(sessionDate)}'`;
  for await (const e of client.listEntities({queryOptions:{filter}})){
    if(String(e.classType||"comprehensive")!=="comprehensive")continue;
    rows.push(e);
  }
  return rows;
}

app.http("comprehensiveAttendance",{
  methods:["GET","POST"],authLevel:"anonymous",route:"comprehensive-attendance",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(!(await canUse(access)))return json({error:"尚未開啟綜合課點名權限"},403);
    await ensureTables();
    const client=table("comprehensive");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      if(!sessionDate)return json({error:"缺少上課日期"},400);
      const latest=new Map();
      const filter=`eventDate eq '${safe(sessionDate)}'`;
      for await (const e of client.listEntities({queryOptions:{filter}})){
        if(String(e.classType||"comprehensive")!=="comprehensive")continue;
        const id=String(e.partitionKey);
        const old=latest.get(id);
        const stamp=`${String(e.createdAt||"")}|${String(e.rowKey||"")}`;
        const oldStamp=old?`${String(old.createdAt||"")}|${String(old.rowKey||"")}`:"";
        if(!old||stamp>=oldStamp)latest.set(id,e);
      }
      return json({sessionDate,items:[...latest.values()].map(e=>({studentId:String(e.partitionKey),groupName:String(e.groupName||""),section:String(e.section||""),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const sessionDate=String(body.sessionDate||"").trim();
    const items=Array.isArray(body.items)?body.items:[];
    if(!sessionDate||!items.length)return json({error:"缺少日期或點名資料"},400);
    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      if(master.status==="inactive"||!allowedGroups.has(String(master.groupName||"")))return json({error:`學生不在綜合課名單：${master.studentName}`},400);
      const oldRows=await existingRows(client,item.studentId,sessionDate);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      const status=String(item.status||"present");
      await client.createEntity({
        partitionKey:String(item.studentId),rowKey:rowKey("c"),eventDate:sessionDate,
        groupName:String(master.groupName||""),section:String(master.section||"待確認"),
        status,minutes:Number(item.minutes??(["present","late"].includes(status)?90:0)),
        teacher:access.email,classType:"comprehensive",createdAt:now
      });
    }
    return json({ok:true,count:items.length,sessionDate},200);
  }
});
