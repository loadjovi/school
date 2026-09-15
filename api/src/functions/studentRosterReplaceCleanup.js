import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listStudentMaster, semesterKey, semesterLabel } from "../lib/storage.js";

function clean(v,max=100){return String(v??"").trim().slice(0,max)}
function stripMeta(e){const x={...e};delete x.etag;delete x.timestamp;return x}
function normalizeKeepIds(input){return [...new Set((Array.isArray(input)?input:[]).map(x=>clean(x,20).replace(/\.0$/,"")).filter(x=>/^\d{6}$/.test(x)))]}
function normalizeSemester(v){const x=clean(v,10);return x==="1"||x==="2"?x:""}
async function deactivateParentMappings(studentId,accessEmail){
  const client=table("userStudentMap"),rows=[];
  for await (const e of client.listEntities({queryOptions:{filter:`RowKey eq '${String(studentId).replaceAll("'","''")}'`}}))rows.push(e);
  for(const e of rows){const next={...stripMeta(e),status:"inactive",deactivatedAt:new Date().toISOString(),deactivatedBy:accessEmail};await client.upsertEntity(next,"Merge")}
  return rows.length;
}
async function removeTeacherPrivateAssignments(studentId){
  const client=table("teacherProfile");let count=0;
  for await (const e of client.listEntities()){
    let ids=[];try{ids=JSON.parse(String(e.privateStudentIds||"[]"))}catch{ids=[]}
    if(!Array.isArray(ids)||!ids.map(String).includes(String(studentId)))continue;
    const next=stripMeta(e);next.privateStudentIds=JSON.stringify(ids.map(String).filter(x=>x!==String(studentId)));next.updatedAt=new Date().toISOString();await client.upsertEntity(next,"Merge");count++;
  }
  return count;
}
function view(e,type="student"){return {type,studentId:String(e.rowKey||""),name:String(e.studentName||""),grade:String(e.grade||""),groupName:String(e.groupName||""),section:String(e.section||"待確認"),instrument:String(e.instrument||""),status:String(e.status||"active"),replacedByStudentId:String(e.replacedByStudentId||"")}}

app.http("studentRosterReplaceCleanup",{
  methods:["POST"],authLevel:"anonymous",route:"student-roster-replace-cleanup",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const action=clean(body.action||"preview",20).toLowerCase(),schoolYear=clean(body.schoolYear||"",12),semester=normalizeSemester(body.semester);
    if(!["preview","apply"].includes(action))return json({error:"action 必須為 preview 或 apply"},400);
    if(!/^[0-9]{2,4}$/.test(schoolYear))return json({error:"學年度格式不正確"},400);
    if(!semester)return json({error:"學期只能是 1（上學期）或 2（下學期）"},400);
    const keepIds=normalizeKeepIds(body.keepStudentNos||body.studentNos);
    if(!keepIds.length)return json({error:"本學期定案至少需要 1 個有效 6 碼學號"},400);
    await ensureTables();
    const keep=new Set(keepIds),term=semesterKey(schoolYear,semester),existing=await listStudentMaster();
    const activeNotInTerm=existing.filter(e=>/^\d{6}$/.test(String(e.rowKey))&&String(e.status||"active")==="active"&&!keep.has(String(e.rowKey)));
    const legacyRemove=existing.filter(e=>!/^\d{6}$/.test(String(e.rowKey)));
    const termRows=[];
    for await (const e of table("semesterEnrollment").listEntities({queryOptions:{filter:`PartitionKey eq '${term.replaceAll("'","''")}'`}}))termRows.push(e);
    const termRemove=termRows.filter(e=>!keep.has(String(e.rowKey)));
    const summary={schoolYear,semester,semesterName:semesterLabel(semester),termKey:term,keep:keepIds.length,deactivateCurrent:activeNotInTerm.length,removeLegacy:legacyRemove.length,removeTermEnrollment:termRemove.length,totalStudentMaster:existing.length};
    const items=[...activeNotInTerm.map(x=>view(x,"本學期不續上課")),...legacyRemove.map(x=>view(x,"移除舊ID"))];
    if(action==="preview")return json({summary,items});
    if(body.confirmReplace!==true)return json({error:"正式定案需要 confirmReplace=true"},400);

    const now=new Date().toISOString(),results=[];
    for(const old of termRemove){try{await table("semesterEnrollment").deleteEntity(String(old.partitionKey),String(old.rowKey))}catch(e){if(e.statusCode!==404)throw e}}

    for(const old of activeNotInTerm){
      const id=String(old.rowKey),next={...old,status:"inactive",inactiveReason:"not_enrolled_in_semester",inactiveForTerm:term,inactiveAt:now,updatedAt:now,updatedBy:access.email};
      await table("studentMaster").updateEntity(next,"Merge");
      await table("studentHistory").createEntity({partitionKey:id,rowKey:rowKey("hist"),changeType:"semester_not_enrolled",schoolYear,semester,changedAt:now,changedBy:access.email,oldValue:JSON.stringify(view(old)),newValue:JSON.stringify({status:"inactive",inactiveForTerm:term,historyPreserved:true})});
      results.push({studentId:id,name:old.studentName||"",action:"inactive_for_term"});
    }

    for(const old of legacyRemove){
      const id=String(old.rowKey),parentMappings=await deactivateParentMappings(id,access.email),teacherProfiles=await removeTeacherPrivateAssignments(id);
      await table("studentHistory").createEntity({partitionKey:id,rowKey:rowKey("hist"),changeType:"legacy_student_id_removed",schoolYear,semester,changedAt:now,changedBy:access.email,oldValue:JSON.stringify(view(old)),newValue:JSON.stringify({removedFromStudentMaster:true,historyPreserved:true,parentMappingsDeactivated:parentMappings,teacherProfilesUpdated:teacherProfiles})});
      try{await table("studentMaster").deleteEntity(String(old.partitionKey||"STUDENT"),id)}catch(e){if(e.statusCode!==404)throw e}
      results.push({studentId:id,name:old.studentName||"",action:"legacy_removed",parentMappingsDeactivated:parentMappings,teacherProfilesUpdated:teacherProfiles});
    }

    return json({ok:true,summary:{...summary,deactivated:activeNotInTerm.length,legacyRemoved:legacyRemove.length,termEnrollmentRemoved:termRemove.length,currentEnrolled:keepIds.length},items:results});
  }
});
