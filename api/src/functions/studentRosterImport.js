import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, listStudentMaster, semesterKey, semesterLabel, tenantSchoolPartition, tenantStudentPartition, tenantTermPartition } from "../lib/storage.js";

const gradeMap={1:"一年級",2:"二年級",3:"三年級",4:"四年級",5:"五年級",6:"六年級"};
function clean(v,max=100){return String(v??"").trim().slice(0,max)}
function normalizeStudentNo(v){return clean(v,20).replace(/\.0$/,"").replace(/\s+/g,"")}
function normalizeSemester(v){const x=clean(v,10);return x==="1"||x==="2"?x:""}
function normalizeGroup(v){
  const x=clean(v,20);
  if(x==="A"||x==="A團")return "A";
  if(x==="B"||x==="B團")return "B";
  if(["儲備","儲備團","新生團"].includes(x))return "儲備";
  return "";
}
function normalizeSection(v){
  const x=clean(v,30).replaceAll(" ","");
  if(["小一","小提1","小提一","小提一部"].includes(x))return "小提一部";
  if(["小二","小提2","小提二","小提二部"].includes(x))return "小提二部";
  if(x.includes("中提"))return "中提";
  if(x.includes("大提")&&!x.includes("低音"))return "大提";
  if(x.includes("低音"))return "低音提";
  return "待確認";
}
function normalizeInstrument(v,section){
  const x=clean(v,30).replaceAll(" ","");
  if(x.includes("小提"))return "小提琴";
  if(x.includes("中提"))return "中提琴";
  if(x.includes("大提")&&!x.includes("低音"))return "大提琴";
  if(x.includes("低音"))return "低音提琴";
  if(section==="小提一部"||section==="小提二部")return "小提琴";
  if(section==="中提")return "中提琴";
  if(section==="大提")return "大提琴";
  if(section==="低音提")return "低音提琴";
  return "待確認";
}
function parseGrade(value,classCode){
  const x=clean(value,20);
  if(/^[1-6]$/.test(x))return gradeMap[Number(x)];
  if(Object.values(gradeMap).includes(x))return x;
  const m=clean(classCode,20).match(/^([1-6])/);
  return m?gradeMap[Number(m[1])]:"";
}
function studentView(e){return {studentId:e.rowKey,studentNo:e.studentNo||(/^\d{6}$/.test(String(e.rowKey))?e.rowKey:""),name:e.studentName,classCode:e.classCode||"",grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",semester:e.semester||"",semesterName:e.semesterName||semesterLabel(e.semester),seatNo:e.seatNo||"",status:e.status||"active"}}
function normalizeRows(input,schoolYear,semester){
  const rows=[],warnings=[],excluded=[],seen=new Set();
  for(let i=0;i<(Array.isArray(input)?input:[]).length;i++){
    const src=input[i]||{};
    const enrollmentStatus=clean(src.enrollmentStatus||src.termStatus||src.status||"正式上課",20);
    if(["不參加","退團","停用","inactive"].includes(enrollmentStatus)){excluded.push({row:i+1,name:clean(src.name||src.studentName,40),studentNo:normalizeStudentNo(src.studentNo||src.studentId),reason:enrollmentStatus});continue}
    if(enrollmentStatus==="待確認"){warnings.push(`第 ${i+1} 筆：${clean(src.name||src.studentName,40)||"未命名"} 本學期狀態仍為「待確認」`);continue}
    const studentNo=normalizeStudentNo(src.studentNo||src.studentId),name=clean(src.name||src.studentName,40),groupName=normalizeGroup(src.groupName);
    if(!name&&!studentNo)continue;
    if(!/^\d{6}$/.test(studentNo)){warnings.push(`第 ${i+1} 筆：${name||"未命名"} 學號「${studentNo||"空白"}」不是 6 碼，已略過`);continue}
    if(seen.has(studentNo))throw new Error(`學號 ${studentNo} 在匯入檔中重複；學號必須是唯一值`);
    seen.add(studentNo);
    const rowYear=clean(src.schoolYear||schoolYear,12),rowSemester=normalizeSemester(src.semester||src.term||semester);
    if(rowYear!==schoolYear){warnings.push(`學號 ${studentNo} ${name}：Excel 學年度 ${rowYear||"空白"} 與目前選擇 ${schoolYear} 不一致`);continue}
    if(rowSemester!==semester){warnings.push(`學號 ${studentNo} ${name}：Excel 學期 ${rowSemester||"空白"} 與目前選擇第 ${semester} 學期不一致`);continue}
    const classCode=clean(src.classCode||`${clean(src.grade,10)}${clean(src.className||src.class,10)}`,20);
    const grade=parseGrade(src.grade,classCode),section=normalizeSection(src.section),instrument=normalizeInstrument(src.instrument,section);
    if(!name){warnings.push(`學號 ${studentNo}：學生姓名空白，已略過`);continue}
    if(!groupName){warnings.push(`學號 ${studentNo} ${name}：團別尚未確認，已略過；請填 A／B／儲備後再匯入`);continue}
    if(!grade){warnings.push(`學號 ${studentNo} ${name}：無法判斷年級，已略過`);continue}
    if(section==="待確認"||instrument==="待確認"){warnings.push(`學號 ${studentNo} ${name}：分部或樂器仍為待確認`);continue}
    rows.push({studentNo,name,classCode,grade,groupName,section,instrument,schoolYear:rowYear,semester:rowSemester,semesterName:semesterLabel(rowSemester),seatNo:clean(src.seatNo||src.seat,10),status:"active",enrollmentStatus:"enrolled"});
  }
  if(!rows.length)throw new Error("沒有可匯入的正式上課學生資料");
  return {rows,warnings,excluded};
}
function compatibleLegacy(e,r){
  const conflicts=[];
  if(clean(e.grade,20)&&clean(e.grade,20)!==r.grade)conflicts.push("年級");
  if(clean(e.groupName,20)&&!["待確認"].includes(clean(e.groupName,20))&&clean(e.groupName,20)!==r.groupName)conflicts.push("團別");
  if(clean(e.classCode,20)&&r.classCode&&clean(e.classCode,20)!==r.classCode)conflicts.push("班級");
  return conflicts.length===0;
}
function stripMeta(e){const x={...e};delete x.etag;delete x.timestamp;return x}
async function migratePartitionRows(key,oldPartition,newPartition,{legacyStudentId="",schoolId="",studentId=""}={}){
  if(!oldPartition||oldPartition===newPartition)return 0;
  const client=table(key),rows=[];
  for await (const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${String(oldPartition).replaceAll("'","''")}'`}}))rows.push(e);
  for(const old of rows){
    const next=stripMeta(old);next.partitionKey=newPartition;
    if(legacyStudentId)next.legacyStudentId=legacyStudentId;
    if(schoolId)next.schoolId=schoolId;
    if(studentId)next.studentId=studentId;
    await client.upsertEntity(next,"Replace");
    try{await client.deleteEntity(String(old.partitionKey),String(old.rowKey))}catch{}
  }
  return rows.length;
}
async function migrateActivityRows(tenantKey,oldId,newId,schoolId){
  const tenant=await migratePartitionRows(tenantKey,tenantStudentPartition(schoolId,oldId),tenantStudentPartition(schoolId,newId),{legacyStudentId:oldId,schoolId,studentId:newId});
  return {tenant,total:tenant};
}
async function migrateParentMappings(oldId,newId,student,accessEmail,schoolId){
  if(!oldId||oldId===newId)return 0;
  const client=table("tenantUserStudentMap"),matches=[],sid=tenantSchoolPartition(schoolId).replaceAll("'","''");
  for await (const e of client.listEntities({queryOptions:{filter:`schoolId eq '${sid}' and RowKey eq '${String(oldId).replaceAll("'","''")}'`}}))matches.push(e);
  let count=0;
  for(const old of matches){
    const next={...stripMeta(old),rowKey:newId,studentNo:newId,studentName:student.name,grade:student.grade,groupName:student.groupName,instrument:student.instrument,schoolYear:student.schoolYear,semester:student.semester,status:"active",legacyStudentId:oldId,migratedAt:new Date().toISOString(),migratedBy:accessEmail};
    await client.upsertEntity(next,"Merge");
    try{await client.deleteEntity(String(old.partitionKey),String(old.rowKey))}catch{}
    count++;
  }
  return count;
}
async function migrateTeacherPrivateAssignments(oldId,newId,schoolId){
  if(!oldId||oldId===newId)return 0;
  const client=table("tenantTeacherProfile");let count=0,sid=tenantSchoolPartition(schoolId).replaceAll("'","''");
  for await (const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${sid}'`}})){
    let ids=[];try{ids=JSON.parse(String(e.privateStudentIds||"[]"))}catch{ids=[]}
    if(!Array.isArray(ids)||!ids.map(String).includes(String(oldId)))continue;
    const replaced=[...new Set(ids.map(String).map(x=>x===String(oldId)?String(newId):x))];
    const next=stripMeta(e);next.privateStudentIds=JSON.stringify(replaced);next.updatedAt=new Date().toISOString();
    await client.upsertEntity(next,"Merge");count++;
  }
  return count;
}
async function migrateRegistrationReferences(oldId,newId,schoolId){
  if(!oldId||oldId===newId)return 0;
  const client=table("tenantRegistrations"),rows=[],sid=tenantSchoolPartition(schoolId).replaceAll("'","''");
  for await (const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${sid}' and studentId eq '${String(oldId).replaceAll("'","''")}'`}}))rows.push(e);
  for(const e of rows){const next=stripMeta(e);next.studentId=newId;next.legacyStudentId=oldId;await client.upsertEntity(next,"Merge")}
  return rows.length;
}
async function migrateHistoricalReferences(oldId,newId,student,accessEmail,schoolId){
  const counts={};
  counts.practice=await migrateActivityRows("tenantPractice",oldId,newId,schoolId);
  counts.section=await migrateActivityRows("tenantSection",oldId,newId,schoolId);
  counts.ensemble=await migrateActivityRows("tenantEnsemble",oldId,newId,schoolId);
  counts.comprehensive=await migrateActivityRows("tenantComprehensive",oldId,newId,schoolId);
  counts.privateLesson=await migrateActivityRows("tenantPrivateLesson",oldId,newId,schoolId);
  counts.parentMappings=await migrateParentMappings(oldId,newId,student,accessEmail,schoolId);
  counts.teacherProfiles=await migrateTeacherPrivateAssignments(oldId,newId,schoolId);
  counts.registrations=await migrateRegistrationReferences(oldId,newId,schoolId);
  return counts;
}
async function saveEnrollment(r,accessEmail,now,schoolId){
  const entity={partitionKey:tenantTermPartition(schoolId,r.schoolYear,r.semester),rowKey:r.studentNo,schoolId,studentId:r.studentNo,studentNo:r.studentNo,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,seatNo:r.seatNo,schoolYear:r.schoolYear,semester:r.semester,semesterName:r.semesterName,status:"enrolled",confirmedAt:now,confirmedBy:accessEmail,updatedAt:now};
  await table("tenantSemesterEnrollment").upsertEntity(entity,"Replace");
}

app.http("studentRosterImport",{
  methods:["POST"],authLevel:"anonymous",route:"student-roster-import",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const action=clean(body.action||"preview",20).toLowerCase(),schoolYear=clean(body.schoolYear||"115",12),semester=normalizeSemester(body.semester||"1");
    if(!/^[0-9]{2,4}$/.test(schoolYear))return json({error:"學年度格式不正確"},400);
    if(!semester)return json({error:"學期只能是 1（上學期）或 2（下學期）"},400);
    if(!["preview","apply"].includes(action))return json({error:"action 必須為 preview 或 apply"},400);
    let parsed;try{parsed=normalizeRows(body.items,schoolYear,semester)}catch(e){return json({error:e.message||"名單解析失敗"},400)}
    await ensureTenantTables();
    const existing=await listStudentMaster("",schoolId),byId=new Map(),byName=new Map();
    for(const e of existing){
      byId.set(String(e.rowKey),e);
      const k=clean(e.studentName,40);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(e);
      const no=normalizeStudentNo(e.studentNo);if(/^\d{6}$/.test(no)&&!byId.has(no))byId.set(no,e);
    }
    const previewRows=[];let createCount=0,updateCount=0,migrateCount=0,conflictCount=0;
    for(const r of parsed.rows){
      const exact=byId.get(r.studentNo)||null;
      if(exact){updateCount++;previewRows.push({...r,action:"update",studentId:String(exact.rowKey),old:studentView(exact)});continue}
      const matches=(byName.get(r.name)||[]).filter(x=>!x.replacedByStudentId);
      if(matches.length===0){createCount++;previewRows.push({...r,action:"create",studentId:r.studentNo});continue}
      if(matches.every(x=>compatibleLegacy(x,r))){migrateCount++;previewRows.push({...r,action:"migrate",studentId:r.studentNo,oldStudentId:String(matches[0].rowKey),oldStudentIds:matches.map(x=>String(x.rowKey)),old:studentView(matches[0])});continue}
      conflictCount++;previewRows.push({...r,action:"conflict",studentId:r.studentNo,message:"找到同名但年級／班級／團別不一致的歷史主檔，為避免誤合併請先人工確認"});
    }
    const summary={total:parsed.rows.length,create:createCount,update:updateCount,migrate:migrateCount,conflict:conflictCount,warnings:parsed.warnings.length,excluded:parsed.excluded.length,schoolYear,semester,semesterName:semesterLabel(semester),termKey:semesterKey(schoolYear,semester)};
    if(action==="preview")return json({summary,items:previewRows,warnings:parsed.warnings,excluded:parsed.excluded,uniqueKey:"studentNo"});
    if(!body.confirmApply)return json({error:"正式匯入需要 confirmApply=true"},400);
    if(conflictCount)return json({error:`有 ${conflictCount} 筆歷史資料衝突，請先處理後再匯入`,summary,items:previewRows},409);
    if(parsed.warnings.length)return json({error:`有 ${parsed.warnings.length} 筆資料尚未完成，請先修正再定案`,summary,warnings:parsed.warnings},409);

    const now=new Date().toISOString(),results=[];
    for(const r of parsed.rows){
      const exact=byId.get(r.studentNo)||null;
      if(exact){
        const entity={...exact,studentNo:r.studentNo,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,semester:r.semester,semesterName:r.semesterName,seatNo:r.seatNo,status:"active",inactiveReason:"",updatedAt:now,updatedBy:access.email};
        await table("tenantStudentMaster").updateEntity(entity,"Merge");
        await saveEnrollment(r,access.email,now,schoolId);
        await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,exact.rowKey),rowKey:rowKey("hist"),schoolId,studentId:String(exact.rowKey),changeType:"semester_roster_update",schoolYear:r.schoolYear,semester:r.semester,changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(exact)),newValue:JSON.stringify(studentView(entity))});
        results.push({studentId:String(exact.rowKey),studentNo:r.studentNo,name:r.name,action:"update"});continue
      }

      const matches=(byName.get(r.name)||[]).filter(x=>!x.replacedByStudentId);
      const entity={partitionKey:tenantSchoolPartition(schoolId),rowKey:r.studentNo,schoolId,studentId:r.studentNo,studentNo:r.studentNo,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,semester:r.semester,semesterName:r.semesterName,seatNo:r.seatNo,status:"active",createdAt:matches[0]?.createdAt||now,updatedAt:now,updatedBy:access.email};
      await table("tenantStudentMaster").createEntity(entity);
      await saveEnrollment(r,access.email,now,schoolId);

      if(matches.length){
        const migrations=[];
        for(const old of matches){
          const migration=await migrateHistoricalReferences(String(old.rowKey),r.studentNo,r,access.email,schoolId);migrations.push({oldStudentId:String(old.rowKey),...migration});
          const retired={...old,status:"inactive",replacedByStudentId:r.studentNo,updatedAt:now,updatedBy:access.email};
          await table("tenantStudentMaster").updateEntity(retired,"Merge");
          await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,old.rowKey),rowKey:rowKey("hist"),schoolId,studentId:String(old.rowKey),changeType:"student_number_replaced",schoolYear:r.schoolYear,semester:r.semester,changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(old)),newValue:JSON.stringify({replacedByStudentId:r.studentNo,status:"inactive",migration})});
        }
        await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,r.studentNo),rowKey:rowKey("hist"),schoolId,studentId:r.studentNo,changeType:"semester_roster_student_number_migration",schoolYear:r.schoolYear,semester:r.semester,changedAt:now,changedBy:access.email,oldValue:JSON.stringify(matches.map(studentView)),newValue:JSON.stringify(studentView(entity)),legacyStudentIds:JSON.stringify(matches.map(x=>String(x.rowKey))),migration:JSON.stringify(migrations)});
        results.push({studentId:r.studentNo,studentNo:r.studentNo,name:r.name,action:"migrate",oldStudentIds:matches.map(x=>String(x.rowKey)),migration:migrations});
      }else{
        await table("tenantStudentHistory").createEntity({partitionKey:tenantStudentPartition(schoolId,r.studentNo),rowKey:rowKey("hist"),schoolId,studentId:r.studentNo,changeType:"semester_roster_create",schoolYear:r.schoolYear,semester:r.semester,changedAt:now,changedBy:access.email,oldValue:"",newValue:JSON.stringify(studentView(entity))});
        results.push({studentId:r.studentNo,studentNo:r.studentNo,name:r.name,action:"create"});
      }
      byId.set(r.studentNo,entity);byName.set(r.name,[entity]);
    }
    return json({ok:true,summary:{...summary,imported:results.length},items:results,warnings:parsed.warnings,excluded:parsed.excluded,uniqueKey:"studentNo"});
  }
});
