export const FEE_PROJECT_KINDS=Object.freeze({
  TEAM_T:"TEAM_T",
  YEAR_END_DINNER:"YEAR_END_DINNER"
});

export const FEE_PROJECT_STATUSES=Object.freeze({
  DRAFT:"DRAFT",
  OPEN:"OPEN",
  CLOSED:"CLOSED"
});

export const PAYMENT_STATUSES=Object.freeze({
  AWAITING_TRANSFER:"AWAITING_TRANSFER",
  REPORTED_UNVERIFIED:"REPORTED_UNVERIFIED",
  VERIFIED:"VERIFIED",
  NOT_REQUIRED:"NOT_REQUIRED"
});

export function isSafeId(value){
  return typeof value==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function isIsoDate(value){
  return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

export function normalizeFeeProject(input={},current={}){
  const kind=String(input.kind??current.kind??"").trim();
  if(!Object.hasOwn(FEE_PROJECT_KINDS,kind))throw new Error("收費類型不正確");
  const title=String(input.title??current.title??"").trim();
  if(!title||title.length>100)throw new Error("請填寫 100 字內的收費專案名稱");
  const dueDate=String(input.dueDate??current.dueDate??"").trim();
  if(!isIsoDate(dueDate))throw new Error("請填寫正確的繳費期限");
  const accountTemplateId=String(input.accountTemplateId??current.accountTemplateId??"").trim();
  if(!isSafeId(accountTemplateId))throw new Error("請選擇收款帳戶");
  const activityId=String(input.activityId??current.activityId??"").trim();
  if(kind===FEE_PROJECT_KINDS.YEAR_END_DINNER&&!isSafeId(activityId))throw new Error("期末聚餐必須選擇活動");
  const instructions=String(input.instructions??current.instructions??"").trim();
  if(instructions.length>1000)throw new Error("繳費說明不可超過 1000 字");
  return {kind,title,dueDate,accountTemplateId,activityId:kind===FEE_PROJECT_KINDS.YEAR_END_DINNER?activityId:"",instructions};
}

export function projectSourceType(kind){
  if(kind===FEE_PROJECT_KINDS.TEAM_T)return "uniform";
  if(kind===FEE_PROJECT_KINDS.YEAR_END_DINNER)return "family";
  throw new Error("不支援的收費來源");
}

export function canParentReport({projectStatus,paymentStatus,amount}={}){
  return projectStatus===FEE_PROJECT_STATUSES.OPEN&&paymentStatus===PAYMENT_STATUSES.AWAITING_TRANSFER&&Number.isSafeInteger(amount)&&amount>0;
}

export function validateTransferReport(input={},expectedAmount){
  if(!Number.isSafeInteger(expectedAmount)||expectedAmount<=0)throw new Error("應繳金額尚未建立");
  const amount=Number(input.amount);
  if(!Number.isSafeInteger(amount)||amount!==expectedAmount)throw new Error("回報金額必須與本專案應繳金額相同");
  const lastFive=String(input.lastFive||"").trim();
  if(!/^\d{5}$/.test(lastFive))throw new Error("請填寫匯出帳號末五碼");
  const transferDate=String(input.transferDate||"").trim();
  if(!isIsoDate(transferDate))throw new Error("請填寫正確的匯款日期");
  return {amount,lastFive,transferDate};
}

export function validateVerification(input={},reportedAmount){
  const amount=Number(input.amount);
  if(!Number.isSafeInteger(reportedAmount)||reportedAmount<=0||amount!==reportedAmount)throw new Error("核帳金額與家長回報不一致");
  const bankPostedAt=String(input.bankPostedAt||"").trim();
  if(!isIsoDate(bankPostedAt))throw new Error("請填寫銀行實際入帳日期");
  const note=String(input.note||"").trim();
  if(!note||note.length>300)throw new Error("請填寫 300 字內的核帳備註");
  return {amount,bankPostedAt,note};
}

export function maskBankAccount(accountNumber){
  const value=String(accountNumber||"").replace(/\s+/g,"");
  if(value.length<4)return "****";
  return `${"*".repeat(Math.max(4,value.length-4))}${value.slice(-4)}`;
}

export function feeProjectStatusLabel(status){
  return ({DRAFT:"草稿",OPEN:"開放繳費",CLOSED:"已結束"})[status]||"未知";
}

export function paymentStatusLabel(status){
  return ({AWAITING_TRANSFER:"待匯款",REPORTED_UNVERIFIED:"已回報，待核帳",VERIFIED:"已確認入帳",NOT_REQUIRED:"無須繳費"})[status]||"待確認";
}
