import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { listTenantRolesByEmail, getTenantDirectory, defaultTenantId, listStudentMaster, getStudentMaster, ensureTables, table, rowKey } from "../lib/storage.js";

function clean(v,max=200){return String(v||"").trim().slice(0,max)}
function isSchoolAdminRole(roles,schoolId){return roles.some(x=>x.role==="schoolAdmin"&&x.status==="active"&&String(x.schoolId||"")===String(schoolId||""))}

app.http("parentSelfBind",{
  methods:["GET","POST"],authLevel:"anonymous",route:"parent-self-bind",
  handler:async request=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);

    const schoolId=clean(request.method==="GET"?request.query.get("schoolId"):(await request.clone().json().catch(()=>({}))).schoolId,80).toLowerCase();
    if(!schoolId)return json({error:"缺少 schoolId"},400);

    const tenant=await getTenantDirectory(schoolId);
    if(!tenant||String(tenant.status||"setup")!=="active")return json({error:"此學校尚未啟用"},409);

    const roles=await listTenantRolesByEmail(access.email,"active");
    if(!isSchoolAdminRole(roles,schoolId))return json({error:"只有該校 School Admin 才能直接將自己的帳號綁定為學生家長"},403);

    if(schoolId!==defaultTenantId())return json({error:"此學校的家長／學生資料尚未完成 Tenant 隔離，Phase 2 完成前暫不開放直接綁定"},409);

    if(request.method==="GET"){
      const students=(await listStudentMaster("active")).filter(x=>/^\d{6}$/.test(String(x.rowKey||""))).map(x=>({
        studentId:String(x.rowKey||""),name:String(x.studentName||""),grade:String(x.grade||""),groupName:String(x.groupName||""),instrument:String(x.instrument||""),section:String(x.section||"待確認")
      }));
      return json({schoolId,schoolName:String(tenant.schoolName||schoolId),students});
    }

    const body=await request.json();
    const studentId=clean(body.studentId,20),relationship=clean(body.relationship,30)||"家長",parentName=clean(body.parentName||access.displayName,80);
    if(!/^\d{6}$/.test(studentId))return json({error:"請選擇正式 6 碼學號學生"},400);
    if(!["父親","母親","監護人","家長","其他"].includes(relationship))return json({error:"家長關係不正確"},400);
    if(body.consent!==true)return json({error:"請先確認此帳號確實為該學生家長／監護人"},400);

    const master=await getStudentMaster(studentId);
    if(!master||String(master.status||"active")==="inactive")return json({error:"學生不存在或已停用"},404);

    await ensureTables();
    const email=String(access.email||"").toLowerCase();
    try{
      const old=await table("userStudentMap").getEntity(email,studentId);
      if(String(old.status||"active")==="active")return json({error:"此 Google 帳號已綁定這位學生"},409);
    }catch(e){if(e.statusCode!==404)throw e}

    const now=new Date().toISOString();
    await table("userStudentMap").upsertEntity({
      partitionKey:email,rowKey:studentId,relationship,parentName,status:"active",registrationId:"",
      studentName:String(master.studentName||""),grade:String(master.grade||""),groupName:String(master.groupName||""),
      instrument:String(master.instrument||""),section:String(master.section||"待確認"),schoolYear:String(master.schoolYear||""),
      studentNo:studentId,createdAt:now,approvedAt:now,approvedBy:access.email,
      bindingSource:"school_admin_self_bind",schoolId
    },"Merge");

    await table("studentHistory").createEntity({
      partitionKey:studentId,rowKey:rowKey("hist"),changeType:"parent_binding_self_add",
      changedAt:now,changedBy:access.email,
      oldValue:JSON.stringify(null),
      newValue:JSON.stringify({parentEmail:email,parentName,relationship,studentId,schoolId,bindingSource:"school_admin_self_bind"})
    });

    return json({ok:true,schoolId,studentId,parentEmail:email,parentName,relationship,createdAt:now});
  }
});