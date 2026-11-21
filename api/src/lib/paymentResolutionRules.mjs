const buildEnablesPaymentResolution = false;
export const paymentResolutionEnabled=()=>buildEnablesPaymentResolution&&process.env.LAB_ENVIRONMENT==="functional-uat";
export const resolutionStatuses=new Set(["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED","REFUNDED"]);
export const paymentOnHold=item=>resolutionStatuses.has(item?.paymentStatus);
export class PaymentResolutionError extends Error{constructor(message,status=400){super(message);this.status=status}}
const fail=(message,status=400)=>{throw new PaymentResolutionError(message,status)};
const money=(value,min=0)=>Number.isSafeInteger(value)&&value>=min&&value<=10000000;
const text=(value,max=300)=>typeof value==="string"&&value.trim().length<=max?value.trim():"";
function date(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||"")&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value}
export function resolutionPayer(item){return String(item.parentEmail||item.requesterEmail||item.paymentHistory?.at(-1)?.lineRecipient||"").trim().toLowerCase()}
export function ownsResolution(access,item,ensureStudentAccess){
 const owner=resolutionPayer(item),emails=[access.email,access.parentAlias].filter(Boolean).map(x=>String(x).toLowerCase());
 const ids=item.studentIds||[item.studentId].filter(Boolean);
 return access.role==="parent"&&owner&&emails.includes(owner)&&ids.length>0&&ids.every(id=>ensureStudentAccess(access,id));
}
export function refundBank(input){
 const bankCode=text(input.bankCode,3),accountNumber=text(input.accountNumber,30),accountHolder=text(input.accountHolder,100);
 if(!/^\d{3}$/.test(bankCode)||!/^\d{6,30}$/.test(accountNumber)||!accountHolder)fail("請填寫退款銀行代碼、帳號與戶名");
 return {bankCode,accountNumber,accountHolder};
}
export function resolutionExpected(item,sourceType,configuredAmount){
 const amount=item.paymentResolution?.expectedAmount??(sourceType==="family"?item.transferReport?.expectedAmount??configuredAmount:item.amount);
 if(!money(amount,1))fail("應繳金額不完整，請先核對原申請",409);return amount;
}
export function changePaymentResolution(item,input,{sourceType,expectedAmount,finance=false,parent=false,actor,at,id}){
 const action=input.action,old=item.paymentResolution,history=item.paymentResolutionEvents||[];
 if(history.length>=50)fail("此筆處理紀錄已達上限，請聯絡管理員保留資料後處理",409);
 if(["CANCELLED","FULFILLED"].includes(item.status)||item.registrationStatus==="CANCELLED"||item.paymentStatus==="REFUNDED")fail("此申請已結案或作廢，不能再次處理",409);
 if(sourceType==="family"&&(!["fieldTrip","yearEndDinner"].includes(item.kind)||item.registrationStatus!=="REGISTERED"))fail("此活動報名目前不可處理款項",409);
 if(sourceType==="uniform"&&(!["regularUniform","competitionUniform"].includes(item.kind)||item.acquisition==="PUBLIC")||sourceType==="staff"&&item.category==="CADRE_FIRST")fail("公費或非付費申請不適用差額處理",409);
 const next={...item},resolution={...old,revision:id},event={id,requestId:input.requestId,action,at,actor,from:item.paymentStatus};
 const needFinance=()=>{if(!finance)fail("僅指定財務幹部可處理此操作",403)};
 const needParent=()=>{if(!parent)fail("僅原繳費家長可處理此操作",403)};
 const bankEvidence=()=>{if(!date(input.bankPostedAt)||!text(input.note))fail("請填寫銀行實際入帳日期與查核備註");return {bankPostedAt:input.bankPostedAt,note:text(input.note)}};
 if(action==="REQUEST_ADJUSTMENT"){
  needFinance();
  if(!["REPORTED_UNVERIFIED","ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus)&&!(sourceType==="staff"&&item.paymentStatus==="AWAITING_TRANSFER"))fail("僅待核帳或補款中的申請可處理差額",409);
  if(!money(input.receivedAmount)||!money(expectedAmount,1)||input.receivedAmount===expectedAmount||!text(input.reason))fail("請填寫銀行確認累計實收金額與差額原因；金額相同請使用核帳");
  if(!date(input.bankPostedAt))fail("請填寫銀行實際入帳日期");
  const evidence={bankPostedAt:input.bankPostedAt,note:text(input.reason)};
  Object.assign(resolution,{expectedAmount,receivedAmount:input.receivedAmount,balance:expectedAmount-input.receivedAmount,reason:text(input.reason),requestedAt:at,requestedBy:actor,...evidence});
  next.paymentStatus="ADJUSTMENT_REQUIRED";
 }else if(action==="REPORT_SUPPLEMENT"){
  needParent();
  if(item.paymentStatus!=="ADJUSTMENT_REQUIRED"||!(old?.balance>0))fail("此筆目前無待補差額",409);
  if(!money(input.amount,1)||input.amount!==old.balance||!date(input.transferDate)||!/^\d{5}$/.test(input.lastFive||""))fail("請依待補差額填寫金額、匯款日期及帳號末五碼");
  resolution.supplement={amount:input.amount,transferDate:input.transferDate,lastFive:input.lastFive,reportedAt:at,reportedBy:actor};
  next.paymentStatus="SUPPLEMENT_REPORTED";
 }else if(action==="REQUEST_REFUND"){
  needParent();
  if(!["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus))fail("此筆目前不可申請退費",409);
  if(!text(input.reason))fail("請填寫退費原因");
  resolution.refundRequest={reason:text(input.reason),requestedAt:at,requestedBy:actor,...(input.bankCode?{bank:refundBank(input)}:{})};
  next.paymentStatus="REFUND_REQUESTED";
 }else if(action==="UPDATE_REFUND_ACCOUNT"){
  needParent();if(item.paymentStatus!=="REFUND_REQUESTED")fail("此筆並非退費申請",409);
  resolution.refundRequest={...old.refundRequest,bank:refundBank(input)};
 }else if(action==="VERIFY_ADJUSTMENT"){
  needFinance();if(!["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus))fail("此筆目前不可核帳",409);
  if(old.receivedAmount>old.expectedAmount)fail("已有溢繳，須先登錄退還溢繳再核帳",409);
  if(!money(input.receivedAmount,1)||input.receivedAmount!==old.expectedAmount)fail("銀行確認累計實收必須等於應繳金額，否則請再次通知差額");
  const evidence=bankEvidence();
  Object.assign(resolution,{receivedAmount:input.receivedAmount,balance:0,resolvedAt:at,resolvedBy:actor,...evidence});
  Object.assign(next,{paymentStatus:"VERIFIED",verifiedBy:actor,verifiedAt:at,bankPostedAt:evidence.bankPostedAt,verificationNote:evidence.note});
  if(sourceType==="staff")Object.assign(next,{paidAmount:input.receivedAmount,bankPostedDate:evidence.bankPostedAt});
 }else if(action==="COMPLETE_REFUND"||action==="REFUND_EXCESS"){
  needFinance();const cancelling=action==="COMPLETE_REFUND";
  if(cancelling?item.paymentStatus!=="REFUND_REQUESTED":item.paymentStatus!=="ADJUSTMENT_REQUIRED"||!(old?.balance<0))fail("此筆目前不可登錄退款",409);
  if(!old?.refundRequest?.bank&&cancelling)fail("請先由家長提供退款帳戶，再完成退款",409);
  if(!money(input.receivedAmount)||input.receivedAmount<old.receivedAmount)fail("請核對全部銀行入帳；累計實收不得少於先前確認金額");
  const refundAmount=cancelling?input.receivedAmount:input.receivedAmount-old.expectedAmount;
  if(!money(refundAmount,cancelling?0:1)||input.refundAmount!==refundAmount||!date(input.refundDate)||!text(input.note)||!text(input.reference,100)||input.refundExecuted!==true)fail("請先完成銀行退款，再填寫正確退款金額、日期、憑據編號、備註並確認已退款");
  Object.assign(resolution,{receivedAmount:input.receivedAmount,balance:cancelling?old.expectedAmount:0,resolvedAt:at,resolvedBy:actor,refund:{amount:refundAmount,date:input.refundDate,reference:text(input.reference,100),note:text(input.note),recordedAt:at,recordedBy:actor}});
  if(cancelling){Object.assign(next,{paymentStatus:"REFUNDED",cancelReason:"家長申請退費，財務已完成退款並作廢",cancelledAt:at,cancelledBy:actor});if(sourceType==="family")next.registrationStatus="CANCELLED";else next.status="CANCELLED"}
  else Object.assign(next,{paymentStatus:"VERIFIED",verifiedAt:at,verifiedBy:actor,verificationNote:"溢繳已退還："+text(input.note),...(sourceType==="staff"?{paidAmount:old.expectedAmount}:{})});
 }else fail("不支援的差額／退費操作");
 event.to=next.paymentStatus;event.expectedAmount=resolution.expectedAmount;event.receivedAmount=resolution.receivedAmount;event.balance=resolution.balance;
 if(resolution.supplement?.reportedAt===at)event.supplement={...resolution.supplement};
 if(action==="REQUEST_ADJUSTMENT"){event.reason=resolution.reason;event.bankPostedAt=resolution.bankPostedAt;event.note=resolution.note}
 if(action==="REQUEST_REFUND")event.reason=resolution.refundRequest.reason;
 if(["REQUEST_REFUND","UPDATE_REFUND_ACCOUNT"].includes(action)&&resolution.refundRequest?.bank){const b=resolution.refundRequest.bank;event.refundBank={bankCode:b.bankCode,lastFour:b.accountNumber.slice(-4),accountHolder:b.accountHolder}}
 if(resolution.refund?.recordedAt===at)event.refund={...resolution.refund};
 next.paymentResolution=resolution;next.paymentResolutionEvents=[...history,event];next.updatedAt=at;
 return next;
}
