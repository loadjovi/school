import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, listStudentMaster } from "../lib/storage.js";

const gradeMap={1:"一年級",2:"二年級",3:"三年級",4:"四年級",5:"五年級",6:"六年級"};
function clean(v,max=100){return String(v??"").trim().slice(0,max)}
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
function parseGrade(classCode){
  const m=clean(classCode,20).match(/^([1-6])/);
  return m?gradeMap[Number(m[1])]:"";
}
function studentView(e){return {studentId:e.rowKey,name:e.studentName,classCode:e.classCode||"",grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"}}
function normalizeRows(input,schoolYear){
  const rows=[],warnings=[];
  for(let i=0;i<(Array.isArray(input)?input:[]).length;i++){
    const src=input[i]||{};
    const classCode=clean(src.classCode,20),name=clean(src.name,40),groupName=normalizeGroup(src.groupName);
    if(!name)continue;
    const grade=parseGrade(classCode),section=normalizeSection(src.section),instrument=normalizeInstrument(src.instrument,section);
    if(!groupName){warnings.push(`第 ${i+1} 筆：${name} 團別無法判斷`);continue}
    if(!grade){warnings.push(`第 ${i+1} 筆：${name} 無法由「${classCode}」判斷年級`);continue}
    rows.push({name,classCode,grade,groupName,section,instrument,schoolYear,status:"active"});
  }
  if(!rows.length)throw new Error("沒有可匯入的學生資料");
  return {rows,warnings};
}
function nextIdFactory(existing,schoolYear){
  const used=new Set(existing.map(x=>x.rowKey));let n=1;
  return ()=>{let id;do{id=`SH${schoolYear}${String(n++).padStart(3,"0")}`}while(used.has(id));used.add(id);return id};
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
    const existing=await listStudentMaster(),byName=new Map();
    for(const e of existing){const k=clean(e.studentName,40);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(e)}
    const previewRows=[];let createCount=0,updateCount=0,conflictCount=0;
    for(const r of parsed.rows){
      const matches=byName.get(r.name)||[];
      if(matches.length===0){createCount++;previewRows.push({...r,action:"create",studentId:""})}
      else if(matches.length===1){updateCount++;previewRows.push({...r,action:"update",studentId:matches[0].rowKey,old:studentView(matches[0])})}
      else{conflictCount++;previewRows.push({...r,action:"conflict",message:"同名學生超過 1 筆"})}
    }
    const summary={total:parsed.rows.length,create:createCount,update:updateCount,conflict:conflictCount,warnings:parsed.warnings.length};
    if(action==="preview")return json({summary,items:previewRows,warnings:parsed.warnings});
    if(!body.confirmApply)return json({error:"正式匯入需要 confirmApply=true"},400);
    if(conflictCount)return json({error:`有 ${conflictCount} 筆同名衝突，請先處理後再匯入`,summary,items:previewRows},409);

    const nextId=nextIdFactory(existing,schoolYear),now=new Date().toISOString(),results=[];
    for(const r of parsed.rows){
      const matches=byName.get(r.name)||[];
      if(matches.length===1){
        const old=matches[0],entity={...old,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,status:"active",updatedAt:now,updatedBy:access.email};
        await table("studentMaster").updateEntity(entity,"Merge");
        await table("studentHistory").createEntity({partitionKey:old.rowKey,rowKey:rowKey("hist"),changeType:"roster_import_update",changedAt:now,changedBy:access.email,oldValue:JSON.stringify(studentView(old)),newValue:JSON.stringify(studentView(entity))});
        results.push({studentId:old.rowKey,name:r.name,action:"update"});
      }else{
        const studentId=nextId(),entity={partitionKey:"STUDENT",rowKey:studentId,studentName:r.name,classCode:r.classCode,grade:r.grade,groupName:r.groupName,section:r.section,instrument:r.instrument,schoolYear:r.schoolYear,status:"active",createdAt:now,updatedAt:now,updatedBy:access.email};
        await table("studentMaster").createEntity(entity);
        await table("studentHistory").createEntity({partitionKey:studentId,rowKey:rowKey("hist"),changeType:"roster_import_create",changedAt:now,changedBy:access.email,oldValue:"",newValue:JSON.stringify(studentView(entity))});
        byName.set(r.name,[entity]);results.push({studentId,name:r.name,action:"create"});
      }
    }
    return json({ok:true,summary:{...summary,imported:results.length},items:results,warnings:parsed.warnings});
  }
});
