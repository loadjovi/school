import {createHash} from "node:crypto";

const uniformKinds=new Set(["regularUniform","competitionUniform"]);
const activeUniform=new Set(["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"]);
const email=value=>String(value||"").trim().toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const group=value=>{const g=String(value||"").trim().replace(/團$/,"").toUpperCase();return ["儲備","預備"].includes(g)?"C":g};
export const paymentNoticeKey=notice=>createHash("sha256").update(JSON.stringify([notice.category,notice.sourceId,email(notice.recipient),notice.version])).digest("hex");
export function uniformNeedsPayment(item){return uniformKinds.has(item?.kind)&&activeUniform.has(item.status)&&item.acquisition!=="PUBLIC"&&Number.isSafeInteger(item.amount)&&item.amount>0&&["","AWAITING_TRANSFER"].includes(String(item.paymentStatus||""))}
export function familyPaymentInfo(config,registration){
  const active=config?.enabled===true&&config.feeStatus==="PUBLISHED"&&(config.paymentOpen===true||config.module==="fieldTrip"&&config.collectionOpen===true);
  const fees=[config?.module==="yearEndDinner"?0:config?.studentFee,config?.firstAdultFee,config?.extraAdultFee,config?.extraChildFee];
  const counts=[(registration?.studentIds||[]).length,1,Number(registration?.adults)-1,Number(registration?.extraChildren)];
  const valid=fees.every(n=>Number.isSafeInteger(n)&&n>=0)&&counts.every(n=>Number.isSafeInteger(n)&&n>=0)&&counts[0]>0&&Number(registration.adults)>=1;
  const amount=valid?fees.reduce((sum,rate,i)=>sum+rate*counts[i],0):null;
  const payable=active&&valid&&Number.isSafeInteger(amount)&&amount>0;
  return {amount,paymentOpen:payable,needsPayment:payable&&registration.registrationStatus==="REGISTERED"&&["","NOT_OPEN","AWAITING_TRANSFER"].includes(String(registration.paymentStatus||""))};
}
export function paymentNoticeCandidates({uniforms=[],families=[],configs=[],students=[],mappings=[],canonicalById={},now=new Date().toISOString()}){
  const canonical=id=>String(canonicalById[String(id)]||id),masters=new Map(students.filter(x=>x.status!=="inactive").map(x=>[String(x.rowKey||x.studentId),x]));
  const parents=new Map(),owners=new Map();
  for(const mapping of mappings){
    const id=canonical(mapping.studentId),address=email(mapping.parentEmail);
    if(!masters.has(id)||!validEmail(address)||mapping.status==="inactive")continue;
    if(!parents.has(address))parents.set(address,new Set());parents.get(address).add(id);
    if(!owners.has(id))owners.set(id,new Set());owners.get(id).add(address);
  }
  const notices=[],configMap=new Map(configs.map(x=>[x.module+":"+x.id,x]));
  const names=ids=>ids.map(id=>String(masters.get(canonical(id))?.studentName||masters.get(canonical(id))?.name||"學生"));
  for(const item of uniforms){
    if(!uniformNeedsPayment(item))continue;
    const id=canonical(item.studentId);
    for(const recipient of owners.get(id)||[])notices.push({category:"uniform",sourceId:item.id,recipient,version:String(item.amount),amount:item.amount,
      title:item.kind==="regularUniform"?"團 T 加購":"A 團比賽服買斷",studentNames:names([id]),studentIds:[id],kind:item.kind,size:item.size||"",quantity:item.quantity||1});
  }
  for(const item of families){
    const config=configMap.get(item.kind+":"+item.activityId),info=familyPaymentInfo(config,item),recipient=email(item.parentEmail),ids=(item.studentIds||[]).map(canonical);
    if(!info.needsPayment||!ids.some(id=>parents.get(recipient)?.has(id)))continue;
    notices.push({category:"family",sourceId:item.id,recipient,version:String(info.amount),amount:info.amount,title:config.title||"活動繳費",studentNames:names(ids),studentIds:ids,kind:item.kind,activityId:item.activityId});
  }
  // Dinner currently requires payment reporting together with registration.
  // Notify eligible, unregistered families when booking/payment is published;
  // this invitation is explicitly not an outstanding bill.
  for(const config of configs){
    if(config.module!=="yearEndDinner"||config.enabled!==true||config.paymentOpen!==true||config.feeStatus!=="PUBLISHED")continue;
    if(config.openAt&&Date.parse(config.openAt)>Date.parse(now)||config.closeAt&&Date.parse(config.closeAt)<Date.parse(now)||config.endAt&&Date.parse(config.endAt)<Date.parse(now)||!config.endAt&&config.startAt&&Date.parse(config.startAt)<Date.parse(now))continue;
    const fees=[config.firstAdultFee,config.extraAdultFee,config.extraChildFee];
    if(!fees.every(n=>Number.isSafeInteger(n)&&n>=0)||!fees.some(n=>n>0))continue;
    const targets=String(config.targetGroups||"ALL").split(",").map(group);
    const booked=new Set(families.filter(x=>x.kind==="yearEndDinner"&&x.activityId===config.id&&x.registrationStatus==="REGISTERED").flatMap(x=>(x.studentIds||[]).map(canonical)));
    for(const [recipient,children] of parents){
      const ids=[...children].filter(id=>targets.includes("ALL")||targets.includes(group(masters.get(id)?.groupName)));
      if(!ids.length||ids.some(id=>booked.has(id)))continue;
      notices.push({category:"dinner_open",sourceId:config.id,recipient,version:JSON.stringify(fees),amount:null,title:config.title||"期末餐會",studentNames:names(ids),studentIds:ids,kind:"yearEndDinner",activityId:config.id});
    }
  }
  return [...new Map(notices.map(notice=>[paymentNoticeKey(notice),notice])).values()];
}
export function noticeInScope(notice,scope){
  if(!scope||scope.kind==="all")return true;
  if(scope.kind==="uniform")return notice.category==="uniform"&&notice.sourceId===scope.id;
  if(scope.kind==="family")return notice.category==="family"&&notice.sourceId===scope.id;
  return scope.kind==="activity"&&notice.kind===scope.module&&notice.activityId===scope.id;
}
export async function deliverPaymentNotices({notices,repository,send,configured=true,disabled=false,preview=false,limit=8,retryFailed=false}){
  const states=await repository.states(),available=[],summary={total:notices.length,sent:0,alreadySent:0,failed:0,unconfirmed:0,remaining:0,status:"complete"};
  for(const notice of notices){
    const key=paymentNoticeKey(notice),old=states.get(key);
    if(old?.status==="SENT"){summary.alreadySent++;continue}
    if(["SENDING","UNCONFIRMED"].includes(old?.status)){summary.unconfirmed++;continue}
    if(old?.status==="FAILED"&&!retryFailed){summary.failed++;continue}
    available.push({notice,key,old});
  }
  summary.remaining=available.length;
  if(!notices.length)return {...summary,status:"not_required"};
  if(disabled||!configured)return {...summary,status:disabled?"disabled":"not_configured"};
  if(preview)return {...summary,status:"preview"};
  const chosen=available.slice(0,Math.max(1,Math.min(8,limit)));
  summary.remaining-=chosen.length;
  const outcomes=await Promise.allSettled(chosen.map(async({notice,key,old})=>{
    if(!await repository.claim(key,notice,old)){summary.unconfirmed++;return}
    try{
      // A family may have paid while the admin was saving another activity.
      if(!await repository.stillDue(notice)){await repository.finish(key,"OBSOLETE");return}
      await repository.audit("payment.email.sending",notice,key);
    }catch(error){await repository.finish(key,"FAILED",{error:"寄送前驗證未完成"});summary.failed++;return}
    let result;
    try{result=await send(notice)}catch(error){result={status:"unconfirmed"}}
    const status=result.status==="sent"?"SENT":result.status==="failed"?"FAILED":"UNCONFIRMED";
    // If a provider accepted a mail but the final ledger update fails, leave
    // the claim in SENDING. Never automatically resend an uncertain delivery.
    try{await repository.finish(key,status,{providerId:result.id||""});await repository.audit("payment.email."+status.toLowerCase(),notice,key)}
    catch(error){summary.unconfirmed++;return}
    if(status==="SENT")summary.sent++;else if(status==="FAILED")summary.failed++;else summary.unconfirmed++;
  }));
  summary.failed+=outcomes.filter(result=>result.status==="rejected").length;
  if(summary.failed||summary.unconfirmed)summary.status="partial";
  return summary;
}

export function reminderNotices(notices, now=new Date()) {
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  return notices.filter(n=>n.category==="uniform").map(n=>({...n,reminder:true,version:n.version+":reminder:"+day}));
}
