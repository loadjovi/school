import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { listStudentMaster, getStudentMaster, ensureTenantTables, table, rowKey, tenantParentPartition, tenantStudentPartition } from "../lib/storage.js";

function clean(v,max=200){return String(v||"").trim().slice(0,max)}
app.http("parentSelfBind",{
  methods:["GET","POST"],authLevel:"anonymous",route:"parent-self-bind",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId,tenant}=context;
    if(access.role!=="admin")return json({error:"只有該校 School Admin 才能直接將自己的帳號綁定為學生家長"},403);

    if(request.method==="GET"){
      const students=(await listStudentMaster("active",schoolId)).filter(x=>/^\d{6}$/.test(String(x.rowKey||""))).map(x=>({
        studentId:String(x.rowKey||""),name:String(x.studentName||""),grade:String(x.grade||""),groupName:String(x.groupName||""),instrument:String(x.instrument||""),section:String(x.section||"待確認")
      }));
      return json({schoolId,schoolName:String(tenant.schoolName||schoolId),students});
    }

    const body=await request.json();
    const studentId=clean(body.studentId,20),relationship=clean(body.relationship,30)||"家長",parentName=clean(body.parentName||access.displayName,80);
    if(!/^\d{6}$/.test(studentId))return json({error:"請選擇正式 6 碼學號學生"},400);
    if(!["父親","母親","監護人","家長","其他"].includes(relationship))return json({error:"家長關係不正確"},400);
    if(body.consent!==true)return json({error:"請先確認此帳號確實為該學生家長／監護人"},400);

    const master=await getStudentMaster(studentId,schoolId);
    if(!master||String(master.status||"active")==="inactive")return json({error:"學生不存在或已停用"},404);

    await ensureTenantTables();
    const email=String(access.email||"").toLowerCase();
    try{
      const old=await table("tenantUserStudentMap").getEntity(tenantParentPartition(schoolId,email),studentId);
      if(String(old.status||"active")==="active")return json({error:"此 Google 帳號已綁定這位學生"},409);
    }catch(e){if(e.statusCode!==404)throw e}

    const now=new Date().toISOString();
    await table("tenantUserStudentMap").upsertEntity({
      partitionKey:tenantParentPartition(schoolId,email),rowKey:studentId,schoolId,parentEmail:email,studentId,relationship,parentName,status:"active",registrationId:"",
      studentName:String(master.studentName||""),grade:String(master.grade||""),groupName:String(master.groupName||""),
      instrument:String(master.instrument||""),section:String(master.section||"待確認"),schoolYear:String(master.schoolYear||""),
      studentNo:studentId,createdAt:now,approvedAt:now,approvedBy:access.email,
      bindingSource:"school_admin_self_bind"
    },"Merge");

    await table("tenantStudentHistory").createEntity({
      partitionKey:tenantStudentPartition(schoolId,studentId),rowKey:rowKey("hist"),schoolId,studentId,changeType:"parent_binding_self_add",
      changedAt:now,changedBy:access.email,
      oldValue:JSON.stringify(null),
      newValue:JSON.stringify({parentEmail:email,parentName,relationship,studentId,schoolId,bindingSource:"school_admin_self_bind"})
    });

    return json({ok:true,schoolId,studentId,parentEmail:email,parentName,relationship,createdAt:now});
  }
});
