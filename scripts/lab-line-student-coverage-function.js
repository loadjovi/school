// Generated into the isolated Functional UAT LAB only; never loaded by Production.
import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {getTenantContext,getStudentAliasInfo,json} from "../lib/auth.js";
import {ensureTenantTables,listStudentMaster,table,tenantSchoolPartition} from "../lib/storage.js";
import {getLineAccountBinding} from "../lib/lineAccountBinding.js";
import {buildLabLineStudentCoverage,parentCoverageKey} from "../lib/labLineStudentCoverage.mjs";

const clean=(value,max=200)=>String(value??"").trim().slice(0,max);
const friendStatusTableName="LabLineFriendStatus";

async function parentLinks(schoolId){
  const items=[],seen=new Set();
  const sid=tenantSchoolPartition(schoolId).replaceAll("'","''");
  for await(const row of table("tenantUserStudentMap").listEntities({queryOptions:{filter:`schoolId eq '${sid}' and status eq 'active'`}})){
    const sourceStudentId=clean(row.rowKey,120),email=clean(row.parentEmail,320).toLowerCase();
    if(!sourceStudentId||!email)continue;
    const alias=await getStudentAliasInfo(sourceStudentId,schoolId);
    const studentId=clean(alias.canonicalStudentId||sourceStudentId,120),key=`${studentId}|${email}`;
    if(seen.has(key))continue;
    seen.add(key);
    items.push({
      studentId,parentEmail:email,status:"active",
      parentName:clean(row.parentName,80),relationship:clean(row.relationship||"家長",30)
    });
  }
  return items;
}

async function friendStatuses(schoolId,emails){
  const values=new Map(),partitionKey=tenantSchoolPartition(schoolId);
  const connection=String(process.env.STORAGE_CONNECTION_STRING||"");
  if(!connection)return values;
  const db=TableClient.fromConnectionString(connection,friendStatusTableName);
  for(const email of emails){
    try{
      const row=await db.getEntity(partitionKey,parentCoverageKey(schoolId,email));
      const status=String(row.friendStatus||"");
      values.set(email,["friend","not_friend","unknown"].includes(status)?status:"unknown");
    }catch(error){
      if(error.statusCode!==404)throw error;
    }
  }
  return values;
}

async function bindings(schoolId,links){
  const emails=[...new Set(links.map(link=>String(link.parentEmail||"").toLowerCase()).filter(Boolean))];
  const friendByEmail=await friendStatuses(schoolId,emails),result=new Map();
  for(let index=0;index<emails.length;index+=8){
    const batch=emails.slice(index,index+8);
    await Promise.all(batch.map(async email=>{
      const binding=await getLineAccountBinding(schoolId,email);
      result.set(email,binding?{...binding,friendStatus:friendByEmail.get(email)||"unknown"}:{bound:false});
    }));
  }
  return result;
}

app.http("labLineStudentCoverage",{
  methods:["GET"],authLevel:"anonymous",route:"line/lab-student-coverage",
  handler:async request=>{
    try{
      assertLabIsolation();
      const context=await getTenantContext(request);if(context.error)return context.error;
      const {access,schoolId}=context;
      if(access.role!=="admin"||access.capabilities?.tenantAdmin!==true)return json({error:"僅授權學校管理員可查看 LAB LINE 綁定統計"},403);
      await ensureTenantTables();
      const [students,links]=await Promise.all([listStudentMaster("",schoolId),parentLinks(schoolId)]);
      const model=buildLabLineStudentCoverage({
        schoolId,
        students:students.map(row=>({studentId:String(row.rowKey),studentName:String(row.studentName||""),status:String(row.status||"active")})),
        parentLinks:links,
        bindingsByEmail:await bindings(schoolId,links)
      });
      return json({...model,note:"學生作為查詢主軸；LINE 綁定仍屬於家長帳號。同一家長關聯多名學生時，家長綁定數只計一次。"});
    }catch(error){
      console.error("LAB LINE student coverage query failed",String(error?.name||"Error").slice(0,40));
      return json({error:"無法讀取 LAB LINE 綁定統計"},500);
    }
  }
});
