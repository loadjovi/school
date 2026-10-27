import {uniformNeedsPayment,familyPaymentInfo} from "./paymentNoticeRules.mjs";
const email=v=>String(v||"").trim().toLowerCase();
export function financeRecipients(admins,assignments){
 const active=new Set(assignments.filter(x=>x.status==="active").map(x=>email(x.email)));
 return [...new Set(admins.filter(x=>x.status==="active"&&x.role==="schoolAdmin").map(x=>email(x.partitionKey||x.email)).filter(x=>active.has(x)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))];
}
export function financeNoticeCandidates({uniforms=[],families=[],configs=[],staff=[],recipients=[]}){
 const out=[];
 const add=(item,sourceType,title,due,amount)=>{
  const reported=item.paymentStatus==="REPORTED_UNVERIFIED";
  if(!due&&!reported||!Number.isSafeInteger(amount)||amount<=0)return;
  const stage=reported?"reported":"due";
  for(const recipient of recipients)out.push({category:"finance",sourceId:sourceType+":"+item.id,recipient,version:JSON.stringify([stage,amount,reported?item.transferReport?.reportedAt||item.updatedAt||"":""]),stage,amount,title,sourceType,itemId:item.id,parentEmail:item.parentEmail||item.requesterEmail||"",studentNames:[item.studentName||item.parentName||item.studentId||""].filter(Boolean)});
 };
 for(const item of uniforms)if(["regularUniform","competitionUniform"].includes(item.kind)&&["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(item.status)&&item.acquisition!=="PUBLIC")add(item,"uniform",item.kind==="regularUniform"?"團 T 加購":"A 團比賽服",uniformNeedsPayment(item),item.amount);
 for(const item of families){
  if(item.registrationStatus!=="REGISTERED")continue;
  const config=configs.find(c=>c.module===item.kind&&c.id===item.activityId),info=familyPaymentInfo(config,item);
  add(item,"family",config?.title||(item.kind==="yearEndDinner"?"期末餐會":"活動繳費"),info.needsPayment,item.transferReport?.expectedAmount??info.amount);
 }
 for(const item of staff)if(item.category!=="CADRE_FIRST"&&item.status==="APPROVED")add(item,"staff","幹部／志工團 T 加購",item.paymentStatus==="AWAITING_TRANSFER",item.amount);
 return out;
}
