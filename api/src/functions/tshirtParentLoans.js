import {app} from "@azure/functions";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {getStudentMaster,ensureTenantTables,table as tenantTable,tenantParentPartition} from "../lib/storage.js";

const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const actions=new Set(["ISSUE_CADRE","BORROW_VOLUNTEER","MARK_WASHING","RETURN"]);
let client,audit;
async function tables(){
 const conn=process.env.STORAGE_CONNECTION_STRING;if(!conn)throw Error("Storage unavailable");
 if(!client){client=TableClient.fromConnectionString(conn,"TenantTshirtParentLoans");await client.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 if(!audit){audit=TableClient.fromConnectionString(conn,"TenantUniformEventAudit");await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
 return {client,audit};
}
function clean(x,n=150){return String(x||"").trim().slice(0,n)}
async function linked(schoolId,email,studentId){
 await ensureTenantTables();
 try{
  const e=await tenantTable("tenantUserStudentMap").getEntity(tenantParentPartition(schoolId,email),studentId);
  return e.status==="active"&&!!await getStudentMaster(studentId,schoolId);
 }catch(e){if(e.statusCode===404)return false;throw e}
}
app.http("tshirtParentLoans",{methods:["GET","POST"],authLevel:"anonymous",route:"uniform-events/parent-loans",handler:async request=>{
 const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
 if(ctx.access.role!=="admin")return json({error:"Admin only"},403);
 try{
  const {client,audit}=await tables(),schoolId=ctx.schoolId;
  if(request.method==="GET"){
   const items=[];for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
    items.push({parentEmail:e.rowKey,parentName:e.parentName,studentId:e.studentId,role:e.role,size:e.size,status:e.status,issuedAt:e.issuedAt,returnedAt:e.returnedAt,etag:e.etag});
   }
   return json({items});
  }
  const data=await request.json(),email=clean(data.parentEmail,320).toLowerCase(),studentId=clean(data.studentId,40),action=clean(data.action,40);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(studentId)||!actions.has(action))return json({error:"Invalid parent, student or action"},400);
  if(!await linked(schoolId,email,studentId))return json({error:"Parent is not actively linked to this student"},403);
  let old;try{old=await client.getEntity(schoolId,email)}catch(e){if(e.statusCode!==404)throw e}
  const previous=old?{parentName:old.parentName,studentId:old.studentId,role:old.role,size:old.size,status:old.status,issuedAt:old.issuedAt,returnedAt:old.returnedAt}:null;
  if(old&&data.etag!==old.etag)return json({error:"Record changed; refresh and retry"},409);
  if(!old&&data.etag)return json({error:"Record changed; refresh and retry"},409);
  const now=new Date().toISOString(),name=clean(data.parentName,80),size=clean(data.size,10);
  let next;
  if(action==="ISSUE_CADRE"){
   if(!sizes.has(size)||!name)return json({error:"Parent name and size required"},400);
   if(old)return json({error:"This parent already has a T-shirt record; lifetime issue or outstanding loan prevents a second issue"},409);
   next={parentName:name,studentId,role:"CADRE",size,status:"ISSUED_LIFETIME",issuedAt:now,returnedAt:""};
  }else if(action==="BORROW_VOLUNTEER"){
   if(!sizes.has(size)||!name)return json({error:"Parent name and size required"},400);
   if(old&&old.status!=="RETURNED")return json({error:"Parent has an active loan or lifetime issued shirt"},409);
   next={parentName:name,studentId,role:"VOLUNTEER",size,status:"BORROWED",issuedAt:now,returnedAt:""};
  }else{
   if(!old||old.role!=="VOLUNTEER")return json({error:"Volunteer loan not found"},409);
   if(action==="MARK_WASHING"&&old.status!=="BORROWED")return json({error:"Only borrowed shirts can be marked washing"},409);
   if(action==="RETURN"&&old.status!=="WASHING")return json({error:"Mark washing before return"},409);
   next={...previous,status:action==="MARK_WASHING"?"WASHING":"RETURNED",returnedAt:action==="RETURN"?now:""};
  }
  await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.parent."+action,subjectId:email,actor:clean(ctx.access.email,200),at:now,details:JSON.stringify({studentId,before:previous,after:next}).slice(0,20000)});
  const entity={partitionKey:schoolId,rowKey:email,...next,updatedAt:now};
  try{if(old)await client.updateEntity(entity,"Replace",{etag:old.etag});else await client.createEntity(entity)}
  catch(e){if([409,412].includes(e.statusCode))return json({error:"Record changed; refresh and retry"},409);throw e}
  return json({item:{parentEmail:email,...next}});
 }catch(e){console.error("tshirtParentLoans",e);return json({error:"Parent T-shirt operation failed"},500)}
}});
