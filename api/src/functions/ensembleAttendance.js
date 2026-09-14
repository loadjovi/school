import { app } from "@azure/functions";
import { getAccess, ensureEnsembleAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");

async function existingRows(client,studentId,sessionDate,groupName){
  const rows=[];
  const filter=`PartitionKey eq '${safe(studentId)}' and eventDate eq '${safe(sessionDate)}'`;
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
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(!(a.role==="admin"||a.capabilities?.ensemble))return json({error:"Forbidden"},403);
    await ensureTables();
    const client=table("ensemble");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      const groupName=String(request.query.get("groupName")||"").trim();
      if(!sessionDate||!groupName)return json({error:"缺少日期或團別"},400);
      if(!["A","B"].includes(groupName)&&a.role!=="admin")return json({error:"目前團體課僅開放 A、B 團"},400);
      if(!ensureEnsembleAccess(a,{groupName}))return json({error:"無此團體課權限"},403);
      const latest=new Map();
      const filter=`eventDate eq '${safe(sessionDate)}'`;
      for await (const e of client.listEntities({queryOptions:{filter}})){
        if(String(e.classType||"ensemble")!=="ensemble")continue;
        if(String(e.groupName||"")!==groupName)continue;
        const id=String(e.partitionKey);
        const old=latest.get(id);
        if(!old||String(e.createdAt||"")>=String(old.createdAt||""))latest.set(id,e);
      }
      return json({sessionDate,groupName,items:[...latest.values()].map(e=>({studentId:String(e.partitionKey),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const sessionDate=String(body.sessionDate||"").trim();
    const groupName=String(body.groupName||"").trim();
    if(!sessionDate||!groupName||!items.length)return json({error:"缺少團別、日期或點名資料"},400);
    if(!["A","B"].includes(groupName)&&a.role!=="admin")return json({error:"目前團體課僅開放 A、B 團"},400);
    if(!ensureEnsembleAccess(a,{groupName}))return json({error:"無此團體課權限"},403);
    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const view={studentId:master.rowKey,groupName:master.groupName,section:master.section||"待確認"};
      if(master.groupName!==groupName||!ensureEnsembleAccess(a,view))return json({error:`無此團體課權限：${master.studentName}`},403);
      const oldRows=await existingRows(client,item.studentId,sessionDate,groupName);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      await client.createEntity({partitionKey:item.studentId,rowKey:rowKey("e"),eventDate:sessionDate,groupName:master.groupName,section:master.section||"待確認",status:String(item.status||"present"),minutes:Number(item.minutes||0),teacher:a.email,classType:"ensemble",createdAt:now});
    }
    return json({ok:true,count:items.length,sessionDate,groupName},200);
  }
});
