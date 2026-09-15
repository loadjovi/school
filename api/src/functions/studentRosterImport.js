import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listStudentMaster } from "../lib/storage.js";

const gradeMap={1:"一年級",2:"二年級",3:"三年級",4:"四年級",5:"五年級",6:"六年級"};
function clean(v,max=100){return String(v??"").trim().slice(0,max)}
function normalizeStudentNo(v){return clean(v,20).replace(/\.0$/,"").replace(/\s+/g,"")}
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
function studentView(e){return {studentId:e.rowKey,studentNo:e.studentNo||(/^[0-9]{6}$/.test(String(e.rowKey))?e.rowKey:""),name:e.studentName,classCode:e.classCode||"",grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",semester:e.semester||"",seatNo:e.seatNo||"",status:e.status||"active"}}
function normalizeRows(input,schoolYear){
  const rows=[],warnings=[],seen=new Set();
  for(let i=0;i<(Array.isArray(input)?input:[]).length;i++){
    const src=input[i]||{};
    const studentNo=normalizeStudentNo(src.studentNo||src.studentId),name=clean(src.name||src.studentName,40),groupName=normalizeGroup(src.groupName);
    if(!name&&!studentNo)continue;
    if(!/^\d{6}$/.test(studentNo)){warnings.push(`第 ${i+1} 筆：${name||"未命名"} 學號「${studentNo||"空白"}」不是 6 碼，已略過`);continue}
    if(seen.has(studentNo))throw new Error(`學號 ${studentNo} 在匯入檔中重複；學號必須是唯一值`);
    seen.add(studentNo);
    const classCode=clean(src.classCode||`${clean(src.grade,10)}${clean(src.className||src.class,10)}`,20);
    const grade=parseGrade(src.grade,classCode),section=normalizeSection(src.section),instrument=normalizeInstrument(src.instrument,section);
    if(!name){warnings.push(`學號 ${studentNo}：學生姓名空白，已略過`);continue}
    if(!groupName){warnings.push(`學號 ${studentNo} ${name}：團別尚未確認，已略過；請填 A／B／儲備後再匯入`);continue}
    if(!grade){warnings.push(`學號 ${studentNo} ${name}：無法判斷年級，已略過`);continue}
    rows.push({studentNo,name,classCode,grade,groupName,section,instrument,schoolYear,semester:clean(src.semester||src.term,10),seatNo:clean(src.seatNo||src.seat,10),status:"active"});
  }
  if(!rows.length)throw new Error("沒有可匯入的學生資料");
  return {rows,warnings};
}
async function migrateParentMappings(oldId,newId,student,accessEmail){
  if(!oldId||oldId===newId)return 0;
  const client=table("userStudentMap"),matches=[];
  for await (const e of client.listEntities({queryOptions:{filter:`RowKey eq '${String(oldId).replaceAll("'","''")}'`}}))matches.push(e);
  let count=0;
  for(const old of matches){
    const next={...old,rowKey:newId,studentName:student.name,grade:student.grade,groupName:student.groupName,instrument:student.instrument,schoolYear:student.schoolYear,status:old.status||"active",legacyStudentId:oldId,migratedAt:new Date().toISOString(),migratedBy:accessEmail};
    delete next.etag;delete next.timestamp;
    await client.upsertEntity(next,"Merge");
    try{await client.deleteEntity(String(old.partitionKey),String(old.rowKey))}catch{}
    count++;
  }
  return count;
}

app.http("studentRosterImport",{
  methods:["POST"],authLevel:"anonymous",route:"student-roster-import",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const action=clean(body.action||"preview",20).toLowerCase(),schoolYear=clean(body.schoolYear||"115",12);
    if(!/^[0-9]{2,4}$/.test(schoolYear))return json({error:"學年度格式不正確"},400);
    if(!["preview","apply"].includes(action))return json({error:"action 必須為 preview 或 apply"},400);
    let parsed;try{parsed=normalizeRows(body.items,schoolYear)}catch(e){return json({error:e.message||"名單解析失敗"},400)}
    await ensureTables();
    const existing=await listStudentMaster(),byId=new Map(),byName=new Map();
    for(const e of existing){
      byId.set(String(e.rowKey),e);
      const k=clean(e.studentName,40);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(e);
      const no=normalizeStudentNo(e.studentNo);if(/^\d{6}$/.test(no)&&!byId.has(no))byId.set(no,e);
    }
    const previewRows=[];let createCount=0,updateCount=0,migrateCount=0,conflictCount=0;
    for(const r of parsed.rows){
      const exact=byId.get(r.studentNo)||null;
      if(exact){updateCount++;previewRows.push({...r,action:"update",studentId:String(exact.rowKey),old:studentView(exact)});continue}
      const matches=(byName.get(r.name)||[]).filter(x=>String(x.status||"active")!=="inactive"||!x.replacedByStudentId);
      if(matches.length===0){createCount++;previewRows.push({...r,action:"create",studentId:r.studentNo})}
      else if(matches.length===1){migrateCount++;previewRows.push({...r,action:"migrate",studentId:r.studentNo,oldStudentId:String(matches[0].rowKey),old:studentView(matches[0])})}
      else{conflictCount++;previewRows.push({...r,action:"conflict",studentId:r.studentNo,message:"同名歷史主檔超過 1 筆，無法安全自動轉成學號"})}
    }
    const summary={total:parsed.rows.length,create:createCount,update:updateCount,migrate:migrateCount,conflict:conflictCount,warnings:parsed.warnings.length};
    if(action==="preview")return json({summary,items:previewRows,warnings:parsed.warnings,uniqueKey:"studentNo"});
    if(!body.confirmApply)return json({error:"正式匯入需要 confirmApply=true"},400);
    if(conflictCount)return json({error:`有 ${conflictCount} 筆歷史同名衝突，請先處理後再匯入`,summary,items:previewRows},409);

    const now=new Date().toISOString(),results=[];
    for(const r of parsed.rows){
      const exact=byId.get(r.studentNo)||null;
      if(exact){
        const entity={...exact,studentNo:r.studentNo,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,semester:r.semester,seatNo:r.seatNo,status:"active",updatedAt:now,updatedBy:access.email};
        await table("studentMaster").updateEntity(entity,"Merge");
        await table("studentHistory").createEntity({partitionKey:String(exact.rowKey),rowKey:rowKey("hist"),changeType:"roster_import_update_by_student_no",changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(exact)),newValue:JSON.stringify(studentView(entity))});
        results.push({studentId:String(exact.rowKey),studentNo:r.studentNo,name:r.name,action:"update"});
        continue;
      }

      const matches=(byName.get(r.name)||[]).filter(x=>String(x.status||"active")!=="inactive"||!x.replacedByStudentId);
      const old=matches.length===1?matches[0]:null;
      const entity={partitionKey:"STUDENT",rowKey:r.studentNo,studentNo:r.studentNo,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,semester:r.semester,seatNo:r.seatNo,status:"active",createdAt:old?.createdAt||now,updatedAt:now,updatedBy:access.email};
      await table("studentMaster").createEntity(entity);

      if(old){
        const retired={...old,status:"inactive",replacedByStudentId:r.studentNo,updatedAt:now,updatedBy:access.email};
        await table("studentMaster").updateEntity(retired,"Merge");
        await migrateParentMappings(String(old.rowKey),r.studentNo,r,access.email);
        await table("studentHistory").createEntity({partitionKey:String(old.rowKey),rowKey:rowKey("hist"),changeType:"student_number_replaced",changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(old)),newValue:JSON.stringify({replacedByStudentId:r.studentNo,status:"inactive"})});
        await table("studentHistory").createEntity({partitionKey:r.studentNo,rowKey:rowKey("hist"),changeType:"student_number_migration",changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(old)),newValue:JSON.stringify(studentView(entity)),legacyStudentId:String(old.rowKey)});
        results.push({studentId:r.studentNo,studentNo:r.studentNo,name:r.name,action:"migrate",oldStudentId:String(old.rowKey)});
      }else{
        await table("studentHistory").createEntity({partitionKey:r.studentNo,rowKey:rowKey("hist"),changeType:"roster_import_create_by_student_no",changedAt:now,changedBy:access.email,oldValue:"",newValue:JSON.stringify(studentView(entity))});
        results.push({studentId:r.studentNo,studentNo:r.studentNo,name:r.name,action:"create"});
      }
      byId.set(r.studentNo,entity);byName.set(r.name,[entity]);
    }
    return json({ok:true,summary:{...summary,imported:results.length},items:results,warnings:parsed.warnings,uniqueKey:"studentNo"});
  }
});
