import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getTenantContext, json } from "../lib/auth.js";
import { syncActivityCalendar, deleteActivityCalendar } from "./calendarEvents.js";

// Phase 2: tenant-scoped administrative configuration. No automatic activation.
const tableName=()=>process.env.UNIFORM_EVENT_CONFIG_TABLE||"TenantUniformEventConfig";
let cached;
async function table(){
  if(!process.env.STORAGE_CONNECTION_STRING)throw new Error("Storage is not configured");
  if(!cached){cached=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,tableName());await cached.createTable().catch(e=>{if(e.statusCode!==409)throw e})}
  return cached;
}
const fixedUniformModules=new Set(["regularUniform","competitionUniform"]);
const modules=new Set(["competitionUniform","regularUniform","fieldTrip","yearEndDinner","calendarActivity"]);
const rowKey=(type,id)=>type+":"+id;
const safeId=(s)=>typeof s==="string"&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
const cleanText=(s,max=500)=>typeof s==="string"&&s.trim().length>0&&s.length<=max;
function validate(data){
  if(!data||typeof data!=="object"||!modules.has(data.module)||typeof data.enabled!=="boolean")throw new Error("Invalid module configuration");
  if(data.module==="fieldTrip"||data.module==="yearEndDinner"){
    if(!cleanText(data.title,120)||!cleanText(data.location,300)||!Number.isFinite(Date.parse(data.startAt)))throw new Error("Activity requires title, location and startAt");
    if(data.paymentMode&&!["PAY_NOW","PAY_LATER","FLEXIBLE"].includes(data.paymentMode))throw new Error("Invalid paymentMode");
    if(data.module==="yearEndDinner"&&data.paymentMode&&data.paymentMode!=="PAY_NOW")throw new Error("Year-end dinner requires pay-after-registration mode");
    for(const f of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"]){const n=data[f]??0;if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid fee: "+f)}
  }
  if(data.module==="calendarActivity"){
    if(!cleanText(data.title,120)||!cleanText(data.location,300)||!/^\d{4}-\d{2}-\d{2}$/.test(data.eventDate||"")||!Number.isFinite(Date.parse(data.eventDate)))throw new Error("活動需填名稱、地點及有效日期");
    if(data.endDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.endDate)||!Number.isFinite(Date.parse(data.endDate))||data.endDate<data.eventDate))throw new Error("活動結束日期不得早於開始日期");
    if(!["competition","performance","general"].includes(data.eventType))throw new Error("請選擇活動類型");
    if(data.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.startTime)||data.endTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime))throw new Error("時間格式須為 HH:mm");
    if(!cleanText(data.note||"詳情待公告",1000)||String(data.timeLabel||"").length>80)throw new Error("備註或時間說明過長");
    if(data.openAt||data.closeAt||data.collectionOpen||["studentFee","firstAdultFee","extraAdultFee","extraChildFee"].some(f=>Number(data[f]||0)!==0))throw new Error("演出／競賽公告不接受報名或收費");
  }
  if(["fieldTrip","calendarActivity"].includes(data.module)&&(!data.targetGroups||!/^ALL$|^(?:A|B|C)(?:,(?:A|B|C))*$/.test(data.targetGroups)||new Set(data.targetGroups.split(",")).size!==data.targetGroups.split(",").length))throw new Error("請選擇有效的活動對象團別");
  if(data.endAt){if(!Number.isFinite(Date.parse(data.endAt)))throw new Error("Invalid endAt");if(Date.parse(data.endAt)<Date.parse(data.startAt))throw new Error("Activity end must not precede start");}
  if(data.openAt&&!Number.isFinite(Date.parse(data.openAt)))throw new Error("Invalid openAt");
  if(data.closeAt&&!Number.isFinite(Date.parse(data.closeAt)))throw new Error("Invalid closeAt");
  if(data.openAt&&data.closeAt&&Date.parse(data.openAt)>Date.parse(data.closeAt))throw new Error("Invalid date window");
}
function publicValue(row){
  const payload=JSON.parse(row.payload||"{}");
  return {...payload,enabled:fixedUniformModules.has(payload.module)?true:payload.enabled,id:row.rowKey.split(":").slice(1).join(":"),updatedAt:row.updatedAt};
}
app.http("uniformEventConfig",{
  methods:["GET","POST","DELETE"],authLevel:"anonymous",route:"uniform-events/config",
  handler:async request=>{
    const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
    const {schoolId,access}=ctx;
    if(!["admin","parent"].includes(access.role))return json({error:"Forbidden"},403);
    try{
      const client=await table();
      if(request.method==="GET"){
        const results=[];
        for await(const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replace(/'/g,"''")}'`}})){
          const item=publicValue(row);
          if(access.role==="admin"||item.enabled===true)results.push(item);
        }
        for(const module of fixedUniformModules)if(!results.some(item=>item.module===module&&item.id==="default"))results.push({module,id:"default",enabled:true});
        return json({items:results});
      }
      if(access.role!=="admin")return json({error:"Admin only"},403);
      const data=await request.json();
      if(!safeId(data.id))return json({error:"Invalid id"},400);
      if(request.method==="DELETE"){
        if(!["fieldTrip","yearEndDinner"].includes(data.module))return json({error:"只可刪除未使用的報名活動。"},400);
        const key=rowKey(data.module,data.id);
        let before;try{before=await client.getEntity(schoolId,key)}catch(e){if(e.statusCode===404)return json({error:"活動已不存在，請重新整理。"},404);throw e}
        const config=JSON.parse(before.payload||"{}");
        if(config.enabled!==false)return json({error:"請先將活動設為暫不顯示，才可刪除。"},409);
        for(const name of ["TenantFamilyEventRegistration","TenantUniformEventRequest"]){
          const registrations=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,name);
          try{
            for await(const row of registrations.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replace(/'/g,"''")}'`}})){
              const value=JSON.parse(row.payload||"{}");
              if(value.kind===data.module&&value.activityId===data.id)return json({error:"此活動已有報名或繳款歷史，不能刪除。"},409);
            }
          }catch(e){if(e.statusCode!==404)throw e}
        }
        const audit=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformEventAudit");
        await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e});
        await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"config.delete",subjectId:key,actor:String(access.email||"admin").slice(0,200),at:new Date().toISOString(),details:JSON.stringify({before:config,reason:"管理員刪除無報名的未顯示活動"}).slice(0,20000)});
        if(data.module==="fieldTrip")await deleteActivityCalendar(schoolId,access,data);
        const accounts=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantEventPaymentAccounts");
        try{await accounts.deleteEntity(schoolId,key)}catch(e){if(e.statusCode!==404)throw e}
        await client.deleteEntity(schoolId,key,{etag:before.etag});
        return json({ok:true,deleted:true,id:data.id});
      }
      validate(data);
      if(fixedUniformModules.has(data.module)&&data.enabled!==true)return json({error:"團 T 與 A 團比賽服固定啟用，無法關閉。"},400);
      if(data.module==="yearEndDinner"&&(data.paymentOpen!==data.enabled||data.feeStatus!==(data.enabled?"PUBLISHED":"DRAFT")))return json({error:"期末聚餐的收款與費率狀態須和家長端顯示同步。"},400);
      // Never publish or enable dinner collection without a saved, valid bank account.
      if(data.module==="yearEndDinner"&&data.enabled===true){
        const accounts=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantEventPaymentAccounts");
        let bank;
        try{bank=await accounts.getEntity(schoolId,"yearEndDinner:"+data.id)}catch(e){if(e.statusCode===404)return json({error:"請先新增並儲存有效的期末聚餐收款帳戶，才能啟用期末聚餐活動。"},400);throw e}
        const info=JSON.parse(bank.payload||"{}");
        if(!info.bankName||!info.accountHolder||!/^[0-9]{3}$/.test(info.bankCode||"")||!/^[0-9]{6,30}$/.test(info.accountNumber||""))return json({error:"收款帳戶資料不完整，無法啟用期末聚餐活動。"},400);
      }
      if(data.module==="fieldTrip"&&data.collectionOpen===true){
        if(data.enabled!==true)return json({error:"請先啟用活動，才能開放第二階段收款。"},400);
        const accounts=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantEventPaymentAccounts");
        let bank;
        try{bank=await accounts.getEntity(schoolId,"fieldTrip:"+data.id)}catch(e){if(e.statusCode===404)return json({error:"請先儲存活動並綁定有效的校外活動收款帳戶。"},400);throw e}
        const info=JSON.parse(bank.payload||"{}");
        if(!info.bankName||!info.accountHolder||!/^[0-9]{3}$/.test(info.bankCode||"")||!/^[0-9]{6,30}$/.test(info.accountNumber||""))return json({error:"校外活動收款帳戶資料不完整。"},400);
      }
      const record={
        partitionKey:schoolId,rowKey:rowKey(data.module,data.id),
        payload:JSON.stringify({...data,enabled:data.enabled===true}),
        updatedAt:new Date().toISOString(),updatedBy:String(access.email||"admin").slice(0,255)
      };
      let before=null;
      try{before=await client.getEntity(schoolId,record.rowKey)}catch(e){if(e.statusCode!==404)throw e}
      const audit=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantUniformEventAudit");
      await audit.createTable().catch(e=>{if(e.statusCode!==409)throw e});
      await client.upsertEntity(record,"Replace");
      await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"config.save",subjectId:record.rowKey,actor:String(access.email||"admin").slice(0,200),at:record.updatedAt,details:JSON.stringify({before:before?JSON.parse(before.payload||"{}"):null,after:JSON.parse(record.payload)}).slice(0,20000)});
      if(["fieldTrip","calendarActivity"].includes(data.module))await syncActivityCalendar(schoolId,access,data);
      return json({item:publicValue(record)});
    }catch(error){
      if(error instanceof SyntaxError||String(error.message||"").startsWith("Invalid")||String(error.message||"").includes("requires")||/^(活動|時間|備註|請選擇|演出)/.test(String(error.message||"")))return json({error:error.message},400);
      console.error("uniformEventConfig error",error);
      return json({error:"設定或行事曆同步失敗；請重新儲存並確認行事曆紀錄。"},500);
    }
  }
});
