const categories=new Set(["CADRE_FIRST","CADRE_EXTRA","VOLUNTEER_EXTRA"]);
const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
export class StaffDemandError extends Error{constructor(message,status=400){super(message);this.status=status}}
const fail=(message,status=400)=>{throw new StaffDemandError(message,status)};
const clean=(v,max)=>typeof v==="string"&&v.trim().length<=max?v.trim():"";
export function newStaffDemand(input,{loan,demands=[],unitPrice,actor,at}){
 const parentEmail=clean(input.parentEmail,320).toLowerCase(),parentName=clean(input.parentName,80),studentId=clean(input.studentId,40);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)||!parentName||!/^\d{6}$/.test(studentId))fail("請選擇已綁定的家長與學生，並填寫家長姓名");
 if(!categories.has(input.category)||!sizes.has(input.size)||!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>20)fail("請確認需求類別、尺寸及件數（1–20 件）");
 if(!Number.isSafeInteger(input.schoolYear)||input.schoolYear<100||input.schoolYear>200||![1,2].includes(input.semester))fail("請確認需求學年度與學期");
 if(typeof input.note!=="string"||input.note.length>300)fail("備註限 300 字");
 const own=demands.filter(x=>x.parentEmail===parentEmail&&x.status!=="CANCELLED");
 if(input.category==="CADRE_FIRST"){
  if(input.quantity!==1)fail("幹部首次公費限 1 件");
  if(loan||own.some(x=>x.category==="CADRE_FIRST"))fail("此家長已有領用／借用或首次公費需求，請核對，勿重複登記",409);
 }
 if(own.some(x=>x.schoolYear===input.schoolYear&&x.semester===input.semester&&x.category===input.category&&x.size===input.size&&!["FULFILLED"].includes(x.status)))fail("此家長已有相同學期、類別及尺寸的需求；請先核對原紀錄",409);
 const free=input.category==="CADRE_FIRST";
 if(!free&&(!Number.isSafeInteger(unitPrice)||unitPrice<1))fail("團 T 售價尚未設定",409);
 return {parentEmail,parentName,studentId,category:input.category,size:input.size,quantity:input.quantity,schoolYear:input.schoolYear,semester:input.semester,note:input.note.trim(),status:"APPROVED",paymentStatus:free?"NOT_REQUIRED":"AWAITING_TRANSFER",unitPrice:free?0:unitPrice,amount:free?0:unitPrice*input.quantity,createdBy:actor,createdAt:at,updatedAt:at};
}
export function updateStaffDemand(previous,input,{finance=false,actor,at}){
 const next={...previous,updatedAt:at};
 if(input.action==="VERIFY_DEMAND_PAYMENT"){
  if(!finance)fail("僅具財務權限人員可確認入帳",403);
  if(previous.category==="CADRE_FIRST"||previous.status!=="APPROVED"||previous.paymentStatus==="VERIFIED")fail("此需求目前不可核帳",409);
  const date=clean(input.bankPostedDate,10),note=clean(input.note,300),lastFive=clean(input.lastFive,5);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!/^\d{5}$/.test(lastFive)||input.paidAmount!==previous.amount||!note)fail("請填寫正確入帳日期、末五碼、核帳說明及與應繳一致的金額");
  return {...next,paymentStatus:"VERIFIED",paidAmount:input.paidAmount,bankPostedDate:date,lastFive,verificationNote:note,verifiedBy:actor,verifiedAt:at};
 }
 if(input.action!=="UPDATE_DEMAND_STATUS")fail("無效的需求操作");
 const transitions={APPROVED:["ORDERED","CANCELLED"],ORDERED:["ARRIVED"],ARRIVED:["FULFILLED"],FULFILLED:[],CANCELLED:[]};
 if(!transitions[previous.status]?.includes(input.status))fail("需求進度已變更，請重新整理",409);
 if(input.status==="ORDERED"&&previous.category!=="CADRE_FIRST"&&previous.paymentStatus!=="VERIFIED")fail("自費需求須由財務確認入帳後才能標記採購",409);
 const note=clean(input.note,300);if(!note)fail("請填寫實際處理說明");
 return {...next,status:input.status,progressNote:note,progressBy:actor,progressAt:at};
}
