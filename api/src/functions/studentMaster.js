import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getStudentMaster, listStudentMaster } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","C","儲備"]);
const allowedGrades=new Set(["一年級","二年級","三年級","四年級","五年級","六年級"]);
const allowedInstruments=new Set(["小提琴","中提琴","大提琴","低音提琴","其他","待確認"]);
const allowedSections=new Set(["小提一部","小提二部","中提","大提","低音提","待確認"]);
function clean(v,max=100){return String(v||"").trim().slice(0,max)}
function defaultSection(instrument){
  if(instrument==="中提琴")return "中提";
  if(instrument==="大提琴")return "大提";
  if(instrument==="低音提琴")return "低音提";
  return "待確認";
}
function view(e){return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||defaultSection(e.instrument),schoolYear:e.schoolYear||"",status:e.status||"active",updatedAt:e.updatedAt||null,updatedBy:e.updatedBy||null}}
function validate(x){
  if(x.studentName.length<2)return "請填寫學生姓名";
  if(!allowedGrades.has(x.grade))return "年級不正確";
  if(!allowedGroups.has(x.groupName))return "團別不正確";
  if(!allowedInstruments.has(x.instrument))return "樂器類別不正確";
  if(!allowedSections.has(x.section))return "分部不正確";
  if(!["active","inactive"].includes(x.status))return "狀態不正確";
  return "";
}

app.http("studentMaster",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"student-master",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    await ensureTables();

    if(request.method==="GET"){
      const status=clean(request.query.get("status"),20);
      const items=await listStudentMaster(status);
      return json({items:items.map(view)});
    }

    const body=await request.json();
    const studentName=clean(body.name||body.studentName,40),grade=clean(body.grade,20),groupName=clean(body.groupName,10),instrument=clean(body.instrument,20),schoolYear=clean(body.schoolYear,20),status=clean(body.status||"active",20);
    const now=new Date().toISOString();

    if(request.method==="POST"){
      const section=clean(body.section||defaultSection(instrument),20);
      const err=validate({studentName,grade,groupName,instrument,section,status});if(err)return json({error:err},400);
      const requested=clean(body.studentId,80);
      const studentId=requested||`SH${(Date.now().toString().slice(-7)+Math.random().toString(36).slice(2,5)).toUpperCase()}`;
      if(await getStudentMaster(studentId))return json({error:"Student ID 已存在"},409);
      const entity={partitionKey:"STUDENT",rowKey:studentId,studentName,grade,groupName,instrument,section,schoolYear,status,createdAt:now,updatedAt:now,updatedBy:access.email};
      await table("studentMaster").createEntity(entity);
      await table("studentHistory").createEntity({partitionKey:studentId,rowKey:rowKey("hist"),changeType:"manual_create",changedAt:now,changedBy:access.email,oldValue:"",newValue:JSON.stringify(view(entity))});
      return json({ok:true,student:view(entity)},201);
    }

    const studentId=clean(body.studentId,80);
    if(!studentId)return json({error:"缺少 studentId"},400);
    const old=await getStudentMaster(studentId);
    if(!old)return json({error:"找不到學生主檔"},404);
    const section=clean(body.section||old.section||defaultSection(instrument),20);
    const err=validate({studentName,grade,groupName,instrument,section,status});if(err)return json({error:err},400);
    const entity={...old,studentName,grade,groupName,instrument,section,schoolYear,status,updatedAt:now,updatedBy:access.email};
    await table("studentMaster").updateEntity(entity,"Merge");
    await table("studentHistory").createEntity({partitionKey:studentId,rowKey:rowKey("hist"),changeType:"profile_update",changedAt:now,changedBy:access.email,oldValue:JSON.stringify(view(old)),newValue:JSON.stringify(view(entity))});
    return json({ok:true,student:view(entity)});
  }
});
