const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
export const cadreActions=new Set(["REQUEST_CADRE","ISSUE_CADRE","CORRECT_CADRE_PENDING","EDIT_CADRE_PENDING"]);
export function cadreApplication(old,{action,size,parentName,studentId,reason=""},now=new Date().toISOString()){
 const fail=message=>{const e=Error(message);e.statusCode=409;throw e};
 if(!sizes.has(size)||!String(parentName||"").trim())fail("請填寫家長姓名與尺寸");
 const [year,month]=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit"}).format(new Date(now)).split("-").map(Number);
 const term={schoolYear:year-1911-(month<8?1:0),semester:month>=2&&month<8?2:1};
 const base={parentName,studentId,role:"CADRE",size,returnedAt:""};
 if(action==="REQUEST_CADRE"){
  if(old)fail("此家長已有紀錄，請從下方紀錄更正或確認領取，勿重複申請");
  return {...base,...term,status:"REQUESTED",requestedAt:now,issuedAt:""};
 }
 if(!old||old.role!=="CADRE")fail("找不到幹部申請紀錄");
 if(action==="ISSUE_CADRE"){
  if(old.status!=="REQUESTED")fail("僅可對尚未領取的申請確認發放");
  return {...old,...base,status:"ISSUED_LIFETIME",issuedAt:now};
 }
 if(action==="EDIT_CADRE_PENDING"){
  if(old.status!=="REQUESTED")fail("已領取者須先更正為尚未領取");
  return {...old,...base};
 }
 if(action==="CORRECT_CADRE_PENDING"){
  if(old.status!=="ISSUED_LIFETIME")fail("僅可更正已領取的幹部紀錄");
  if(!String(reason).trim()||String(reason).length>300)fail("請填寫更正原因（限 300 字）");
  return {...old,...base,...term,status:"REQUESTED",requestedAt:now,previousIssuedAt:old.issuedAt||"",issuedAt:"",correctionReason:String(reason).trim()};
 }
 fail("不支援的幹部操作");
}
