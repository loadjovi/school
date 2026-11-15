// This function is installed by the guarded lineuat build only.
import {createHash} from "node:crypto";
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,json} from "../lib/auth.js";
import {defaultTenantId,getMappedStudentsByEmail,getStudentMaster} from "../lib/storage.js";
import {assertLabIsolation} from "../lib/labIsolation.mjs";

assertLabIsolation();
const bankId="line_uat_bank_20261115";

async function addFixture(name,schoolId,rowKey,payload){
  const db=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
  await db.createTable().catch(error=>{if(error.statusCode!==409)throw error});
  try{
    await db.createEntity({partitionKey:schoolId,rowKey,payload:JSON.stringify(payload),updatedAt:new Date().toISOString()});
  }catch(error){if(error.statusCode!==409)throw error}
}

app.http("lineUatFeeFixture",{
  methods:["POST"],authLevel:"anonymous",route:"sop-lab/line-uat-fee-fixture",
  handler:async request=>{
    assertLabIsolation();
    const context=await getTenantContext(request);
    if(context.error)return context.error;
    const {schoolId,access}=context;
    if(schoolId!==defaultTenantId()||access.role!=="admin"||access.capabilities?.financeVerifier!==true)
      return json({error:"僅限聖心 DEMO 財務驗收人員"},403);
    const students=await getMappedStudentsByEmail(access.email,schoolId);
    let student;
    for(const item of students){
      if(!/^99010[1-6]$/.test(item.studentId))continue;
      const master=await getStudentMaster(item.studentId,schoolId);
      if(master?.updatedBy==="SOP_LAB_FIXTURE"){student=item;break}
    }
    if(!student)return json({error:"請先在 SOP LAB 使用此帳號綁定虛構測試學生"},409);
    const marker="LINE_UAT_FEE_FIXTURE";
    const owner=createHash("sha256").update(access.email).digest("hex").slice(0,12);
    const activityId="line_uat_dinner_20261115_"+owner;
    await addFixture("TenantPaymentAccountTemplates",schoolId,bankId,{
      label:"DEMO 虛構收款帳戶｜請勿匯款",bankName:"DEMO 銀行",bankCode:"999",
      accountHolder:"DEMO 專用｜請勿匯款",accountNumber:"000000000000",active:true,fixtureId:marker
    });
    await addFixture(process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig",schoolId,"yearEndDinner:"+activityId,{
      id:activityId,module:"yearEndDinner",title:"DEMO 期末聚餐｜收費驗收",enabled:true,
      feeStatus:"PUBLISHED",firstAdultFee:400,extraAdultFee:0,extraChildFee:0,eventDate:"2026-12-18",
      bankAccountTemplateId:bankId,fixtureId:marker
    });
    await addFixture("TenantFamilyEventRegistration",schoolId,"line_uat_family_20261115_"+owner,{
      kind:"yearEndDinner",activityId,studentIds:[student.studentId],adults:1,extraChildren:0,
      parentEmail:access.email,estimatedAmount:400,registrationStatus:"REGISTERED",paymentStatus:"AWAITING_TRANSFER",
      fixtureId:marker
    });
    return json({ok:true,activityId,bankId});
  }
});
