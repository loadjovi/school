"""Generate a school-admin-only parent-test binding endpoint for isolated SOP UAT."""
from pathlib import Path

API_JS=r'''
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {tenantParentPartition,tenantStudentPartition,rowKey} from "../lib/storage.js";
import {getLabReadiness,assertLabIsolation} from "../lib/labIsolation.mjs";
assertLabIsolation();

// Exact fixture IDs; no arbitrary students or emails can be assigned.
const fixtures=new Map([
 ["990101","測試甲同學"],["990102","測試乙同學"],["990103","測試丙同學"],
 ["990104","測試丁同學"],["990105","測試戊同學"],["990106","測試己同學"]
]);
const client=async name=>{
 const c=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
 await c.createTable().catch(e=>{if(e.statusCode!==409)throw e});
 return c;
};
app.http("sopLabParentBinding",{
 methods:["GET","POST"],authLevel:"anonymous",route:"sop-lab/parent-binding",
 handler:async request=>{
  const ready=getLabReadiness();
  if(!ready.ready||ready.environment!=="functional-uat"||
     ready.storageAccount!==process.env.LAB_EXPECTED_STORAGE_ACCOUNT)
   return json({error:"LAB 獨立資料庫驗證未通過，禁止建立家長關聯"},503);
  const ctx=await getTenantContext(request);
  if(ctx.error)return ctx.error;
  if(ctx.access.role!=="admin")return json({error:"限 LAB 學校管理員綁定自己的測試家長身分"},403);
  const schoolId=ctx.schoolId,email=String(ctx.access.email||"").trim().toLowerCase();
  if(!email||!schoolId)return json({error:"身分資料不完整"},403);
  const master=await client(process.env.TENANT_STUDENT_MASTER_TABLE||"TenantStudentMaster");
  const maps=await client(process.env.TENANT_USER_STUDENT_MAP_TABLE||"TenantUserStudentMap");
  const partition=tenantParentPartition(schoolId,email);
  if(request.method==="GET"){
   const items=[];
   for(const [studentId,name] of fixtures){
    let present=false;
    try{
     const s=await master.getEntity(schoolId,studentId);
     present=s.studentName===name&&s.updatedBy==="SOP_LAB_FIXTURE";
    }catch(e){if(e.statusCode!==404)throw e}
    let bound=false;
    try{
     const row=await maps.getEntity(partition,studentId);
     bound=row.status==="active";
    }catch(e){if(e.statusCode!==404)throw e}
    items.push({studentId,name,available:present,bound});
   }
   return json({ok:true,items,schoolId});
  }
  const body=await request.json().catch(()=>({}));
  const studentId=String(body?.studentId||"");
  if(body?.confirmation!=="BIND_MY_LAB_PARENT"||!fixtures.has(studentId))
   return json({error:"請明確選擇並確認綁定一位虛構 LAB 學生"},400);
  const s=await master.getEntity(schoolId,studentId).catch(e=>{if(e.statusCode===404)return null;throw e});
  if(!s||s.studentName!==fixtures.get(studentId)||s.updatedBy!=="SOP_LAB_FIXTURE")
   return json({error:"僅允許綁定目前 LAB 產生的六位虛構學生"},403);
  try{
   const old=await maps.getEntity(partition,studentId);
   if(old.status==="active")return json({ok:true,alreadyBound:true,studentId,name:s.studentName});
   return json({error:"這組家長關聯已存在但非啟用狀態；不自動覆蓋"},409);
  }catch(e){if(e.statusCode!==404)throw e}
  const now=new Date().toISOString();
  const link={partitionKey:partition,rowKey:studentId,schoolId,
   parentEmail:email,parentName:"LAB 測試家長",relationship:"家長",
   studentId,studentNo:studentId,studentName:s.studentName,
   grade:s.grade||"",groupName:s.groupName||"",instrument:s.instrument||"",
   section:s.section||"",schoolYear:s.schoolYear||"",status:"active",
   registrationId:"",createdAt:now,approvedAt:now,
   approvedBy:email,bindingSource:"sop_lab_fixture_self_binding"};
  try{await maps.createEntity(link)}
  catch(e){
   if(e.statusCode===409)return json({error:"關聯剛被其他操作建立，請重新讀取"},409);
   throw e;
  }
  let auditSaved=true;
  try{
   const history=await client(process.env.TENANT_STUDENT_HISTORY_TABLE||"TenantStudentHistory");
   await history.createEntity({partitionKey:tenantStudentPartition(schoolId,studentId),
    rowKey:rowKey("hist"),schoolId,studentId,changeType:"sop_lab_test_parent_binding",
    changedAt:now,changedBy:email,oldValue:"null",
    newValue:JSON.stringify({studentId,schoolId,bindingSource:"sop_lab_fixture_self_binding"})});
  }catch(e){auditSaved=false;console.error("UAT parent-binding audit failed",e)}
  return json({ok:true,created:true,studentId,name:s.studentName,auditSaved,
    message:"已在獨立 LAB 將目前登入帳號綁定為虛構學生的測試家長"});
 }
});
'''
def install(api_root:Path):
    (api_root/"src"/"functions"/"sopLabParentBinding.js").write_text(API_JS.lstrip(),encoding="utf-8")
