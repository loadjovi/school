import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { ensureTables, table, rowKey, getRegistrationsByEmail, listRegistrations, getStudentMaster, listStudentMaster } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","C","儲備"]);
const allowedGrades=new Set(["一年級","二年級","三年級","四年級","五年級","六年級"]);
const allowedInstruments=new Set(["小提琴","中提琴","大提琴","低音提琴","其他"]);

function clean(v,max=100){return String(v||"").trim().slice(0,max)}
function validateStudentFields({studentName,grade,groupName,instrument}){
  if(studentName.length<2)return "請填寫學生姓名";
  if(!allowedGrades.has(grade))return "請選擇正確年級";
  if(!allowedGroups.has(groupName))return "請選擇正確團別";
  if(!allowedInstruments.has(instrument))return "請選擇樂器類別";
  return "";
}
function view(e){
  return {
    registrationId:e.rowKey,parentEmail:e.parentEmail,parentName:e.parentName,relationship:e.relationship,
    studentName:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,
    schoolYear:e.schoolYear||"",status:e.status,studentId:e.studentId||null,createdAt:e.createdAt,
    reviewedAt:e.reviewedAt||null,reviewedBy:e.reviewedBy||null,note:e.note||""
  };
}

app.http("studentRegistration",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"student-registration",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);

    if(request.method==="GET"){
      if(access.role==="admin"){
        const status=clean(request.query.get("status"),20);
        const items=await listRegistrations(status);
        return json({items:items.map(view)});
      }
      const items=await getRegistrationsByEmail(access.email);
      return json({items:items.map(view)});
    }

    if(request.method==="POST"){
      if(["sectionTeacher","privateTeacher","admin"].includes(access.role))return json({error:"此帳號角色不可提交家長學生登記"},403);
      const body=await request.json();
      const studentName=clean(body.studentName,40),grade=clean(body.grade,20),groupName=clean(body.groupName,10),instrument=clean(body.instrument,20);
      const parentName=clean(body.parentName||access.displayName,40),relationship=clean(body.relationship,20),schoolYear=clean(body.schoolYear,20);
      const err=validateStudentFields({studentName,grade,groupName,instrument});if(err)return json({error:err},400);
      if(!relationship)return json({error:"請填寫與學生關係"},400);
      if(body.consent!==true)return json({error:"請勾選資料使用確認"},400);

      const existing=await getRegistrationsByEmail(access.email);
      if(existing.find(x=>x.studentName===studentName&&["pending","approved"].includes(x.status)))return json({error:"此學生已有待審核或已核准的登記資料"},409);

      await ensureTables();
      const registrationId=rowKey("reg");
      const entity={partitionKey:"REG",rowKey:registrationId,parentEmail:access.email,parentName,relationship,studentName,grade,groupName,instrument,schoolYear,status:"pending",consent:true,createdAt:new Date().toISOString(),googleSub:access.sub||""};
      await table("registrations").createEntity(entity);
      return json({ok:true,registration:view(entity)},201);
    }

    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const registrationId=clean(body.registrationId,120),action=clean(body.action,20).toLowerCase(),note=clean(body.note,300);
    if(!registrationId||!["approve","reject"].includes(action))return json({error:"缺少 registrationId 或 action"},400);

    await ensureTables();
    const regClient=table("registrations");
    let reg;
    try{reg=await regClient.getEntity("REG",registrationId)}catch(e){if(e.statusCode===404)return json({error:"找不到登記資料"},404);throw e}
    if(reg.status!=="pending")return json({error:"此登記已完成審核"},409);

    if(action==="reject"){
      reg.status="rejected";reg.reviewedAt=new Date().toISOString();reg.reviewedBy=access.email;reg.note=note;
      await regClient.updateEntity(reg,"Merge");
      return json({ok:true,status:"rejected"});
    }

    const studentName=clean(body.studentName||reg.studentName,40),grade=clean(body.grade||reg.grade,20),groupName=clean(body.groupName||reg.groupName,10),instrument=clean(body.instrument||reg.instrument,20),schoolYear=clean(body.schoolYear||reg.schoolYear,20);
    const err=validateStudentFields({studentName,grade,groupName,instrument});if(err)return json({error:err},400);

    let studentId=clean(body.studentId,80);
    let oldMaster=null;
    if(studentId){
      oldMaster=await getStudentMaster(studentId);
      if(!oldMaster)return json({error:"指定的既有學生不存在"},404);
    }else{
      const sameName=(await listStudentMaster("active")).filter(x=>clean(x.studentName,40)===studentName);
      if(sameName.length===1){
        oldMaster=sameName[0];
        studentId=String(oldMaster.rowKey);
      }else if(sameName.length>1){
        return json({error:"找到多筆同名在團學生，請先在審核畫面指定正確學生再核准",matches:sameName.map(x=>({studentId:x.rowKey,studentName:x.studentName,grade:x.grade,groupName:x.groupName,section:x.section||"待確認",instrument:x.instrument}))},409);
      }else{
        const suffix=(Date.now().toString().slice(-7)+Math.random().toString(36).slice(2,5)).toUpperCase();
        studentId=`SH${suffix}`;
      }
    }

    const now=new Date().toISOString();
    const master={partitionKey:"STUDENT",rowKey:studentId,studentName,grade,groupName,instrument,schoolYear,status:"active",updatedAt:now,updatedBy:access.email};
    if(oldMaster){master.createdAt=oldMaster.createdAt||now;await table("studentMaster").upsertEntity(master,"Merge");}
    else{master.createdAt=now;await table("studentMaster").createEntity(master);}

    await table("studentHistory").createEntity({
      partitionKey:studentId,rowKey:rowKey("hist"),changeType:oldMaster?"registration_link_update":"registration_approved",
      changedAt:now,changedBy:access.email,
      oldValue:oldMaster?JSON.stringify({studentName:oldMaster.studentName,grade:oldMaster.grade,groupName:oldMaster.groupName,instrument:oldMaster.instrument,schoolYear:oldMaster.schoolYear||""}):"",
      newValue:JSON.stringify({studentName,grade,groupName,instrument,schoolYear}),registrationId
    });

    await table("userStudentMap").upsertEntity({
      partitionKey:String(reg.parentEmail).toLowerCase(),rowKey:studentId,relationship:reg.relationship,status:"active",registrationId,
      studentName,grade,groupName,instrument,schoolYear,createdAt:now,approvedBy:access.email
    },"Merge");

    reg.status="approved";reg.studentId=studentId;reg.studentName=studentName;reg.grade=grade;reg.groupName=groupName;reg.instrument=instrument;reg.schoolYear=schoolYear;reg.reviewedAt=now;reg.reviewedBy=access.email;reg.note=note;
    await regClient.updateEntity(reg,"Merge");
    return json({ok:true,status:"approved",studentId,linkedExisting:!!oldMaster});
  }
});
