import {safePaymentNotifications} from "./paymentNotifications.js";
import {TableClient} from "@azure/data-tables";
import {randomUUID} from "node:crypto";
import {json} from "./auth.js";
import {getUniformPrice} from "./uniformPricing.js";
import {newStaffDemand,updateStaffDemand,StaffDemandError} from "./tshirtStaffDemandRules.mjs";

const response=(body,status=200)=>({...json(body,status),headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const decode=row=>({...JSON.parse(row.payload),id:row.rowKey,etag:row.etag});
export async function staffProcurement(request,ctx,{loanClient,audit,linked,data}){
 if(ctx.access.role!=="admin")return response({error:"Admin only"},403);
 try{
  const client=TableClient.fromConnectionString(process.env.STORAGE_CONNECTION_STRING,"TenantTshirtStaffDemand");
  await client.createTable().catch(e=>{if(e.statusCode!==409)throw e});
  const schoolId=ctx.schoolId,actor=String(ctx.access.email||"admin"),at=new Date().toISOString();
  const finance=ctx.access.capabilities?.financeVerifier===true;
  const safe=item=>{if(finance)return item;const {lastFive,bankPostedDate,verificationNote,paidAmount,...rest}=item;return rest};
  const all=async()=>{const out=[];for await(const row of client.listEntities({queryOptions:{filter:`PartitionKey eq '${schoolId.replaceAll("'","''")}'`}}))out.push(decode(row));return out};
  if(request.method==="GET")return response({items:(await all()).map(safe),canVerifyFinance:finance});
  const input=data||await request.json();let next,id,old;
  if(input.action==="ADD_DEMAND"){
   if(!await linked(schoolId,String(input.parentEmail||"").trim().toLowerCase(),String(input.studentId||"")))return response({error:"此家長未綁定目前在團學生，請先核對家長綁定"},403);
   let loan;try{loan=await loanClient.getEntity(schoolId,String(input.parentEmail).trim().toLowerCase())}catch(e){if(e.statusCode!==404)throw e}
   next=newStaffDemand(input,{loan,demands:await all(),unitPrice:(await getUniformPrice(schoolId,"regularUniform")).unitPrice,actor,at});
   // One permanent key per parent for the lifetime entitlement; purchase entries are separate.
   id=input.category==="CADRE_FIRST"?"first-"+Buffer.from(next.parentEmail).toString("base64url"):randomUUID();
   if(input.category==="CADRE_FIRST")try{old=await client.getEntity(schoolId,id)}catch(e){if(e.statusCode!==404)throw e}
   if(old){if(decode(old).status!=="CANCELLED"||input.etag!==old.etag)return response({error:"首次公費需求已存在；如需重登，請重新整理並核對取消紀錄"},409)}
  }else{
   id=String(input.id||"");if(!/^[a-zA-Z0-9_-]{1,500}$/.test(id)||typeof input.etag!=="string")return response({error:"請重新載入需求紀錄"},400);
   try{old=await client.getEntity(schoolId,id)}catch(e){if(e.statusCode===404)return response({error:"找不到需求紀錄"},404);throw e}
   if(input.etag!==old.etag)return response({error:"需求已更新，請重新整理"},409);
   next=updateStaffDemand(JSON.parse(old.payload),input,{finance,actor,at});
  }
  await audit.createEntity({partitionKey:schoolId,rowKey:randomUUID(),action:"tshirt.staff."+input.action,subjectId:id,actor,at,details:JSON.stringify({parentEmail:next.parentEmail,category:next.category,size:next.size,quantity:next.quantity,from:old?decode(old).status:null,to:next.status,paymentStatus:next.paymentStatus,note:next.progressNote||next.verificationNote||next.note}).slice(0,20000)});
  const entity={partitionKey:schoolId,rowKey:id,payload:JSON.stringify(next),updatedAt:at};
  try{if(old)await client.updateEntity(entity,"Replace",{etag:old.etag});else await client.createEntity(entity)}catch(e){if([409,412].includes(e.statusCode))return response({error:"需求已被其他人更新，請重新整理"},409);throw e}
  const paymentNotification=input.action==="ADD_DEMAND"&&next.paymentStatus==="AWAITING_TRANSFER"?await safePaymentNotifications(schoolId,{scope:{kind:"staff",id}}):null;
  return response({item:safe({...next,id}),paymentNotification});
 }catch(e){if(e instanceof StaffDemandError)return response({error:e.message},e.status);console.error("staffProcurement",e);return response({error:"團 T 幹部／志工需求處理失敗，請重新整理確認"},500)}
}
