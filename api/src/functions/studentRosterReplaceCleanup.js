import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listStudentMaster } from "../lib/storage.js";

function clean(v,max=100){return String(v??"").trim().slice(0,max)}
function stripMeta(e){const x={...e};delete x.etag;delete x.timestamp;return x}
function normalizeKeepIds(input){
  return [...new Set((Array.isArray(input)?input:[]).map(x=>clean(x,20).replace(/\.0$/,"")).filter(x=>/^\d{6}$/.test(x)))];
}
async function deactivateParentMappings(studentId,accessEmail){
  const client=table("userStudentMap"),rows=[];
  for await (const e of client.listEntities({queryOptions:{filter:`RowKey eq '${String(studentId).replaceAll("'","''")}'`}}))rows.push(e);
  for(const e of rows){
    const next={...stripMeta(e),status:"inactive",deactivatedAt:new Date().toISOString(),deactivatedBy:accessEmail};
    await client.upsertEntity(next,"Merge");
  }
  return rows.length;
}
async function removeTeacherPrivateAssignments(studentId){
  const client=table("teacherProfile");let count=0;
  for await (const e of client.listEntities()){
    let ids=[];try{ids=JSON.parse(String(e.privateStudentIds||"[]"))}catch{ids=[]}
    if(!Array.isArray(ids)||!ids.map(String).includes(String(studentId)))continue;
    const next=stripMeta(e);
    next.privateStudentIds=JSON.stringify(ids.map(String).filter(x=>x!==String(studentId)));
    next.updatedAt=new Date().toISOString();
    await client.upsertEntity(next,"Merge");count++;
  }
  return count;
}
function view(e){return {studentId:String(e.rowKey||""),name:String(e.studentName||""),grade:String(e.grade||""),groupName:String(e.groupName||""),section:String(e.section||"待確認"),instrument:String(e.instrument||""),status:String(e.status||"active"),replacedByStudentId:String(e.replacedByStudentId||"")}}

app.http("studentRosterReplaceCleanup",{
  methods:["POST"],authLevel:"anonymous",route:"student-roster-replace-cleanup",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const action=clean(body.action||"preview",20).toLowerCase();
    if(!["preview","apply"].includes(action))return json({error:"action 必須為 preview 或 apply"},400);
    const keepIds=normalizeKeepIds(body.keepStudentNos||body.studentNos);
    if(!keepIds.length)return json({error:"完整覆蓋至少需要 1 個有效 6 碼學號"},400);
    await ensureTables();
    const keep=new Set(keepIds),existing=await listStudentMaster();
    const remove=existing.filter(e=>!keep.has(String(e.rowKey)));
    const summary={keep:keepIds.length,remove:remove.length,totalBefore:existing.length};
    if(action==="preview")return json({summary,items:remove.map(view)});
    if(body.confirmReplace!==true)return json({error:"正式覆蓋需要 confirmReplace=true"},400);

    const now=new Date().toISOString(),results=[];
    for(const old of remove){
      const id=String(old.rowKey),parentMappings=await deactivateParentMappings(id,access.email),teacherProfiles=await removeTeacherPrivateAssignments(id);
      await table("studentHistory").createEntity({
        partitionKey:id,rowKey:rowKey("hist"),changeType:"roster_full_replace_remove",changedAt:now,changedBy:access.email,
        oldValue:JSON.stringify(view(old)),newValue:JSON.stringify({removedFromStudentMaster:true,historyPreserved:true,parentMappingsDeactivated:parentMappings,teacherProfilesUpdated:teacherProfiles})
      });
      await table("studentMaster").deleteEntity(String(old.partitionKey||"STUDENT"),id);
      results.push({studentId:id,name:old.studentName||"",parentMappingsDeactivated:parentMappings,teacherProfilesUpdated:teacherProfiles});
    }
    return json({ok:true,summary:{...summary,removed:results.length,totalAfter:keepIds.length},items:results});
  }
});
