import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getTenantContext, ensureStudentAccess, json } from "../lib/auth.js";
import { getStudentMaster } from "../lib/storage.js";

const kinds=new Set(["regularUniform","competitionUniform","fieldTrip","yearEndDinner"]);
const states=new Set(["PENDING","APPROVED","CANCELLED","FULFILLED"]);
const connection=()=>process.env.STORAGE_CONNECTION_STRING;
const clients=new Map();
async function table(kind){
  const name=kind==="requests"?"TenantUniformEventRequest":kind==="inventory"?"TenantUniformInventory":"TenantUniformEventAudit";
  if(!connection())throw new Error("Storage unavailable");
  if(!clients.has(name)){const client=TableClient.fromConnectionString(connection(),name);await client.createTable().catch(e=>{if(e.statusCode!==409)throw e});clients.set(name,client)}
  return clients.get(name);
}
const validId=s=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const qty=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const safe=(s,n=200)=>typeof s==="string"&&s.length<=n;
const err=(msg,status=400)=>json({error:msg},status);
const encode=x=>JSON.stringify(x);
const decode=e=>({...JSON.parse(e.payload||"{}"),id:e.rowKey,etag:e.etag,updatedAt:e.updatedAt});
async function find(client,schoolId,id){try{return await client.getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return null;throw e}}
async function audit(schoolId,access,action,id,details){
  const client=await table("audit");
  await client.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action,subjectId:id,actor:String(access.email||"unknown").slice(0,200),at:new Date().toISOString(),details:encode(details).slice(0,20000)});
}
async function configuredAndOpen(schoolId,data){
  const client=TableClient.fromConnectionString(connection(),process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig");
  const id=["fieldTrip","yearEndDinner"].includes(data.kind)?data.activityId:"default";
  if(!validId(id))return false;
  const row=await find(client,schoolId,data.kind+":"+id);
  if(!row)return false;
  const cfg=JSON.parse(row.payload||"{}"),now=Date.now();
  return cfg.enabled===true&&(!cfg.openAt||Date.parse(cfg.openAt)<=now)&&(!cfg.closeAt||Date.parse(cfg.closeAt)>=now);
}
async function studentGuard(access,schoolId,studentId){
  if(!validId(studentId)||!ensureStudentAccess(access,studentId))return false;
  const student=await getStudentMaster(studentId,schoolId);
  return Boolean(student);
}
function validateRequest(data,student){
  if(!data||!kinds.has(data.kind)||!validId(data.studentId))throw new Error("Invalid request");
  if(!safe(data.note||"",1000))throw new Error("Invalid note");
  if(data.kind==="regularUniform"){
    if(!["8","10","12","XS","S","M","L","XL","2L","3L","5L"].includes(data.size)||!qty(data.quantity)||data.quantity<1||data.quantity>20)throw new Error("Invalid shirt size or quantity");
    // Eligibility is not client-authoritative; all requests await admin verification.
    return {size:data.size,quantity:data.quantity,freeEligibility:"PENDING",amount:null};
  }
  if(data.kind==="competitionUniform"){
    if(String(student.groupName)!=="A")throw new Error("Only A group");
    const allowed=data.style==="女"?["XS","S","M","L"]:data.style==="男"?["S","M","L","2L"]:[];
    if(!allowed.includes(data.size)||!["RENTAL","PURCHASE","PENDING"].includes(data.acquisition))throw new Error("Invalid competition selection");
    return {style:data.style,size:data.size,acquisition:data.acquisition,amount:null};
  }
  if(!validId(data.activityId))throw new Error("Activity ID required");
  if(!qty(data.adults??0)||!qty(data.extraChildren??0)||data.adults>20||data.extraChildren>20)throw new Error("Invalid attendees");
  return {activityId:data.activityId,adults:data.adults??0,extraChildren:data.extraChildren??0,amount:null};
}
app.http("uniformEventRequests",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"uniform-events/requests",
  handler:async request=>{
    const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
    const {schoolId,access}=ctx;
    if(!["admin","parent"].includes(access.role))return err("Forbidden",403);
    try{
      const client=await table("requests");
      if(request.method==="GET"){
        const out=[];
        for await(const e of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}})){
          const item=decode(e);
          if(access.role==="admin"||ensureStudentAccess(access,item.studentId))out.push(item);
        }
        return json({items:out});
      }
      const data=await request.json();
      if(request.method==="POST"){
        if(!await studentGuard(access,schoolId,data.studentId))return err("Student not found or forbidden",403);
        if(!await configuredAndOpen(schoolId,data))return err("Module or activity is not open",403);
        const student=await getStudentMaster(data.studentId,schoolId);
        const fields=validateRequest(data,student);
        const id=randomUUID(),createdAt=new Date().toISOString();
        const payload={kind:data.kind,studentId:data.studentId,...fields,status:"PENDING",note:data.note||"",createdAt,updatedAt:createdAt};
        // Audit before accepting mutation. If audit fails, request is not accepted.
        await audit(schoolId,access,"request.create",id,{kind:data.kind,studentId:data.studentId});
        await client.createEntity({partitionKey:schoolId,rowKey:id,payload:encode(payload),updatedAt:createdAt});
        return json({item:{...payload,id}},201);
      }
      if(access.role!=="admin")return err("Admin only",403);
      if(!validId(data.id)||!states.has(data.status)||!safe(data.etag,200))return err("Invalid update");
      const previous=await find(client,schoolId,data.id);
      if(!previous)return err("Not found",404);
      if(data.etag!==previous.etag)return err("Record changed, refresh and retry",409);
      const before=decode(previous);
      const next={...JSON.parse(previous.payload),status:data.status,updatedAt:new Date().toISOString()};
      if(data.status==="FULFILLED" && before.status!=="FULFILLED")return err("Use inventory issuance workflow before fulfillment",409);
      await audit(schoolId,access,"request.status",data.id,{from:before.status,to:data.status});
      try{await client.updateEntity({partitionKey:schoolId,rowKey:data.id,payload:encode(next),updatedAt:next.updatedAt},"Replace",{etag:previous.etag})}
      catch(e){if(e.statusCode===412)return err("Record changed, refresh and retry",409);throw e}
      return json({item:{...next,id:data.id}});
    }catch(e){
      if(e instanceof SyntaxError||String(e.message||"").startsWith("Invalid")||String(e.message||"").startsWith("Only"))return err(e.message);
      console.error("uniformEventRequests",e);return err("Request processing failed",500);
    }
  }
});
