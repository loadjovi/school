import { app } from "@azure/functions";
import { getAccess, ensureEnsembleAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster } from "../lib/storage.js";

app.http("ensembleAttendance",{
  methods:["POST"],authLevel:"anonymous",route:"ensemble-attendance",
  handler:async(request)=>{
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(!(a.role==="admin"||a.capabilities?.ensemble))return json({error:"Forbidden"},403);
    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const groupName=String(body.groupName||"").trim();
    if(!body.sessionDate||!groupName||!items.length)return json({error:"缺少團別、日期或點名資料"},400);
    if(!["A","B"].includes(groupName)&&a.role!=="admin")return json({error:"目前團體課僅開放 A、B 團"},400);
    await ensureTables();
    const client=table("ensemble");
    for(const item of items){
      const master=await getStudentMaster(item.studentId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const view={studentId:master.rowKey,groupName:master.groupName,section:master.section||"待確認"};
      if(master.groupName!==groupName||!ensureEnsembleAccess(a,view))return json({error:`無此團體課權限：${master.studentName}`},403);
      await client.createEntity({
        partitionKey:item.studentId,
        rowKey:rowKey("e"),
        eventDate:body.sessionDate,
        groupName:master.groupName,
        section:master.section||"待確認",
        status:item.status,
        minutes:Number(item.minutes||0),
        teacher:a.email,
        classType:"ensemble",
        createdAt:new Date().toISOString()
      });
    }
    return json({ok:true,count:items.length},201);
  }
});
