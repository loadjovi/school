import { app } from "@azure/functions";
import { getAccess, ensureSectionAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster } from "../lib/storage.js";

const safe=v=>String(v||"").replaceAll("'","''");

async function existingRows(client,studentId,sessionDate,groupName,section){
  const rows=[];
  const filter=`PartitionKey eq '${safe(studentId)}' and eventDate eq '${safe(sessionDate)}'`;
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
    const a=await getAccess(request);
    if(!a.authenticated)return json({error:"Unauthorized"},401);
    if(!(a.role==="admin"||a.capabilities?.section))return json({error:"Forbidden"},403);
    await ensureTables();
    const client=table("section");

    if(request.method==="GET"){
      const sessionDate=String(request.query.get("sessionDate")||"").trim();
      const groupName=String(request.query.get("groupName")||"").trim();
      const section=String(request.query.get("section")||"").trim();
      if(!sessionDate||!groupName||!section)return json({error:"缺少日期、團別或分部"},400);
      if(!ensureSectionAccess(a,{groupName,section}))return json({error:"無此分部課權限"},403);
      const latest=new Map();
      const filter=`eventDate eq '${safe(sessionDate)}'`;
      for await (const e of client.listEntities({queryOptions:{filter}})){
        if(String(e.classType||"section")!=="section")continue;
        if(String(e.groupName||"")!==groupName||String(e.section||"")!==section)continue;
        const id=String(e.partitionKey);
        const old=latest.get(id);
        if(!old||String(e.createdAt||"")>=String(old.createdAt||""))latest.set(id,e);
      }
      return json({sessionDate,groupName,section,items:[...latest.values()].map(e=>({studentId:String(e.partitionKey),status:String(e.status||"present"),minutes:Number(e.minutes||0),teacher:String(e.teacher||""),createdAt:String(e.createdAt||"")}))});
    }

    const body=await request.json();
    const items=Array.isArray(body.items)?body.items:[];
    const sessionDate=String(body.sessionDate||"").trim();
    const requestedGroup=String(body.groupName||"").trim();
    const requestedSection=String(body.section||"").trim();
    if(!sessionDate||!requestedGroup||!requestedSection||!items.length)return json({error:"缺少日期、團別、分部或點名資料"},400);
    if(!ensureSectionAccess(a,{groupName:requestedGroup,section:requestedSection}))return json({error:"無此分部課權限"},403);

    const now=new Date().toISOString();
    for(const item of items){
      const master=await getStudentMaster(item.studentId);
      if(!master)return json({error:`找不到學生 ${item.studentId}`},404);
      const section=String(master.section||"待確認");
      const groupName=String(master.groupName||"");
      const view={studentId:master.rowKey,groupName,section};
      if(groupName!==requestedGroup||section!==requestedSection||!ensureSectionAccess(a,view))return json({error:`無此分部課權限：${master.studentName}`},403);
      const oldRows=await existingRows(client,item.studentId,sessionDate,groupName,section);
      for(const old of oldRows)await client.deleteEntity(String(old.partitionKey),String(old.rowKey));
      await client.createEntity({partitionKey:item.studentId,rowKey:rowKey("s"),eventDate:sessionDate,section,groupName,status:String(item.status||"present"),minutes:Number(item.minutes||0),teacher:a.email,classType:"section",createdAt:now});
    }
    return json({ok:true,count:items.length,sessionDate,groupName:requestedGroup,section:requestedSection},200);
  }
});
