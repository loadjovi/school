import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { ensureTenantTables, table, rowKey, getRegistrationsByEmail, listRegistrations, getStudentMaster, listStudentMaster, tenantParentPartition, tenantSchoolPartition, tenantStudentPartition } from "../lib/storage.js";
import { sendParentApprovalEmail } from "../lib/email.js";

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
    studentName:e.studentName,classCode:e.classCode||"",grade:e.grade,groupName:e.groupName,instrument:e.instrument,
    schoolYear:e.schoolYear||"",status:e.status,studentId:e.studentId||null,createdAt:e.createdAt,
    reviewedAt:e.reviewedAt||null,reviewedBy:e.reviewedBy||null,note:e.note||"",
    notificationStatus:e.notificationStatus||"",notificationSentAt:e.notificationSentAt||null,notificationError:e.notificationError||""
  };
}

app.http("studentRegistration",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"student-registration",
  handler:async(request)=>{
    const context=await getTenantContext(request,{allowUnassigned:true});if(context.error)return context.error;
    const {access,schoolId}=context;

    if(request.method==="GET"){
      if(access.role==="admin"){
        const status=clean(request.query.get("status"),20);
        const items=await listRegistrations(status,schoolId);
        return json({items:items.map(view)});
      }
      const items=await getRegistrationsByEmail(access.email,schoolId);
      return json({items:items.map(view)});
    }

    if(request.method==="POST"){
      if(["sectionTeacher","privateTeacher","admin"].includes(access.role))return json({error:"此帳號角色不可提交家長學生登記"},403);
      const body=await request.json();
      const studentName=clean(body.studentName,40),classCode=clean(body.classCode,20);
      const parentName=clean(access.displayName,40),relationship="家長";
      if(studentName.length<2)return json({error:"請填寫學生姓名"},400);\n      if(!classCode)return json({error:"請填寫學生班級"},400);
      if(body.consent!==true)return json({error:"請勾選資料使用確認"},400);

      const existing=await getRegistrationsByEmail(access.email,schoolId);
      if(existing.find(x=>x.studentName===studentName&&["pending","approved"].includes(x.status)))return json({error:"此學生已有待審核或已核准的登記資料"},409);

      const sameName=(await listStudentMaster("active",schoolId)).filter(x=>clean(x.studentName,40)===studentName&&/^\\d{6}$/.test(String(x.rowKey||"")));
      if(!sameName.length)return json({error:"找不到這位學生，請確認姓名是否與學校名單完全相同"},404);
      if(sameName.length>1)return json({error:"學校名單有同名學生，請聯絡管理員協助綁定"},409);
      const matched=sameName[0],grade=clean(matched.grade,20),groupName=clean(matched.groupName,10),instrument=clean(matched.instrument,20),schoolYear=clean(matched.schoolYear,20);
      await ensureTenantTables();
      const registrationId=rowKey("reg");
      const entity={partitionKey:tenantSchoolPartition(schoolId),rowKey:registrationId,schoolId,parentEmail:access.email,parentName,relationship,studentName,classCode,grade,groupName,instrument,schoolYear,status:"pending",consent:true,createdAt:new Date().toISOString(),googleSub:access.sub||"",matchedStudentId:String(matched.rowKey||"")};
      await table("tenantRegistrations").createEntity(entity);
      return json({ok:true,registration:view(entity)},201);
    }

    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const body=await request.json();
    const registrationId=clean(body.registrationId,120),action=clean(body.action,20).toLowerCase(),note=clean(body.note,300);
    if(!registrationId||!["approve","reject"].includes(action))return json({error:"缺少 registrationId 或 action"},400);

    await ensureTenantTables();
    const regClient=table("tenantRegistrations"),schoolPartition=tenantSchoolPartition(schoolId);
    let reg;
    try{reg=await regClient.getEntity(schoolPartition,registrationId)}catch(e){if(e.statusCode===404)return json({error:"找不到登記資料"},404);throw e}
    if(reg.status!=="pending")return json({error:"此登記已完成審核"},409);

    if(action==="reject"){
      reg.status="rejected";reg.reviewedAt=new Date().toISOString();reg.reviewedBy=access.email;reg.note=note;
      await regClient.updateEntity(reg,"Merge");
      return json({ok:true,status:"rejected"});
    }

    const studentName=clean(reg.studentName,40);
    let studentId=clean(body.studentId||reg.matchedStudentId,20);
    let oldMaster=null;
    if(studentId){
      if(!/^\d{6}$/.test(studentId))return json({error:"請選擇正式 6 碼學號的學生主檔"},400);
      oldMaster=await getStudentMaster(studentId,schoolId);
      if(!oldMaster||oldMaster.status==="inactive")return json({error:"指定的學號不存在或已停用"},404);
    }else{
      const sameName=(await listStudentMaster("active",schoolId)).filter(x=>clean(x.studentName,40)===studentName&&/^\d{6}$/.test(String(x.rowKey)));
      if(sameName.length===1){
        oldMaster=sameName[0];studentId=String(oldMaster.rowKey);
      }else if(sameName.length>1){
        return json({error:"找到多筆同名學生，請在審核畫面指定正確學號再核准",matches:sameName.map(x=>({studentId:x.rowKey,studentName:x.studentName,grade:x.grade,groupName:x.groupName,section:x.section||"待確認",instrument:x.instrument}))},409);
      }else{
        return json({error:"找不到可綁定的正式學號。請先到「學生主檔」匯入／建立 6 碼學號，再回來核准家長帳號。"},409);
      }
    }

    const grade=clean(oldMaster.grade,20),groupName=clean(oldMaster.groupName,10),instrument=clean(oldMaster.instrument,20),schoolYear=clean(oldMaster.schoolYear,20);
    const now=new Date().toISOString();

    await table("tenantStudentHistory").createEntity({
      partitionKey:tenantStudentPartition(schoolId,studentId),rowKey:rowKey("hist"),schoolId,studentId,changeType:"parent_registration_link",
      changedAt:now,changedBy:access.email,
      oldValue:JSON.stringify(null),
      newValue:JSON.stringify({parentEmail:reg.parentEmail,studentName,studentNo:studentId}),registrationId
    });

    await table("tenantUserStudentMap").upsertEntity({
      partitionKey:tenantParentPartition(schoolId,reg.parentEmail),rowKey:studentId,schoolId,parentEmail:String(reg.parentEmail).toLowerCase(),studentId,relationship:reg.relationship,status:"active",registrationId,
      studentName,grade,groupName,instrument,schoolYear,studentNo:studentId,createdAt:now,approvedBy:access.email
    },"Merge");

    reg.status="approved";reg.studentId=studentId;reg.studentName=studentName;reg.grade=grade;reg.groupName=groupName;reg.instrument=instrument;reg.schoolYear=schoolYear;reg.reviewedAt=now;reg.reviewedBy=access.email;reg.note=note;reg.notificationStatus="pending";reg.notificationError="";
    await regClient.updateEntity(reg,"Merge");

    let notification;
    try{
      notification=await sendParentApprovalEmail({
        recipient:reg.parentEmail,parentName:reg.parentName,studentName,grade,groupName,instrument
      });
    }catch(e){
      notification={status:"failed",error:String(e?.message||e||"email_send_failed").slice(0,500)};
    }
    const notificationNow=new Date().toISOString();
    reg.notificationStatus=notification?.status||"failed";
    reg.notificationSentAt=notification?.status==="sent"?notificationNow:"";
    reg.notificationError=notification?.status==="failed"?String(notification?.error||notification?.rawStatus||"寄送失敗").slice(0,500):notification?.status==="not_configured"?"Email 環境變數未設定":"";
    reg.notificationMessageId=String(notification?.messageId||"").slice(0,200);
    await regClient.updateEntity(reg,"Merge");

    return json({ok:true,status:"approved",studentId,linkedExisting:true,notification:{
      status:reg.notificationStatus,sentAt:reg.notificationSentAt||null,error:reg.notificationError||"",messageId:reg.notificationMessageId||""
    }});
  }
});
