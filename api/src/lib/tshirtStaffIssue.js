const sizes=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
const address=value=>String(value||"").trim().toLowerCase();
export const staffReceiptKey=id=>"staff-received:"+Buffer.from(String(id)).toString("base64url");
export const staffIssueKey=id=>"staff-issued:"+Buffer.from(String(id)).toString("base64url");
export const cadreIssueKey=email=>"cadre-issued:"+Buffer.from(address(email)).toString("base64url");
const fail=message=>{throw Object.assign(Error(message),{statusCode:409})};
export async function getStaffIssueRow(client,schoolId,id){try{return await client.getEntity(schoolId,id)}catch(error){if(error.statusCode===404)return null;throw error}}
const compatible=(ledger,record,id)=>ledger&&ledger.parentEmail===address(record.parentEmail)&&ledger.size===record.size&&ledger.quantity===record.quantity&&ledger.category===record.category&&ledger.sourceId===id;

// One physical handover, whether confirmed from procurement or the cadre record,
// has one inventory ledger. The ledger and deduction share one Table transaction.
export async function issueStaffTshirt({inventory,schoolId,id,record,actor,note,loanClient}){
 if(!["CADRE_FIRST","CADRE_EXTRA","VOLUNTEER_EXTRA"].includes(record.category)||!sizes.has(record.size)||!Number.isSafeInteger(record.quantity)||record.quantity<1||record.quantity>20||!address(record.parentEmail)||record.category==="CADRE_FIRST"&&record.quantity!==1)fail("幹部／志工領用資料不完整，請先核對");
 const key=record.category==="CADRE_FIRST"?cadreIssueKey(record.parentEmail):staffIssueKey(id);
 const existing=await getStaffIssueRow(inventory,schoolId,key);
 if(existing){if(!compatible(existing,record,id))fail("此領用與既有發放紀錄不同，請先核對");return {ledger:existing,alreadyIssued:true}}
 if(record.status!=="ARRIVED"||record.category!=="CADRE_FIRST"&&record.paymentStatus!=="VERIFIED")fail("只有已到貨且完成核帳的需求可以實際發放");
 if(loanClient&&record.category==="CADRE_FIRST"){
  const loan=await getStaffIssueRow(loanClient,schoolId,address(record.parentEmail));
  if(loan&&(loan.role!=="CADRE"||loan.status!=="REQUESTED"||loan.size!==record.size))fail("此家長已有歷史領用或其他借用紀錄，請先核對，不會補扣庫存");
 }
 const receipt=await getStaffIssueRow(inventory,schoolId,staffReceiptKey(id));
 if(receipt&&(receipt.demandId!==id||receipt.size!==record.size||receipt.quantity!==record.quantity||receipt.purchaseOrderId!==record.purchaseOrderId))fail("需求與到貨保留紀錄不一致，請先核對");
 if(record.purchaseOrderId&&!receipt&&!await getStaffIssueRow(inventory,schoolId,"po-received:"+record.purchaseOrderId))fail("此採購單尚未完成整單到貨，請先驗收入庫");
 const stock=await getStaffIssueRow(inventory,schoolId,"regular:"+record.size),reserved=stock?.reserved??0,unavailable=stock?.unavailable??0,own=receipt?.reservedQuantity??0;
 if(!stock||![stock.onHand,reserved,unavailable,own].every(value=>Number.isSafeInteger(value)&&value>=0)||![0,record.quantity].includes(own)||reserved<own||stock.onHand-reserved+own-unavailable<record.quantity)fail("此尺寸可用庫存不足，請重新核對到貨與保留數量");
 const ledger={partitionKey:schoolId,rowKey:key,kind:"regularUniform",sourceType:"staff",sourceId:id,parentEmail:address(record.parentEmail),parentName:record.parentName||"",studentId:record.studentId||"",category:record.category,size:record.size,quantity:record.quantity,purchaseOrderId:record.purchaseOrderId||"",issuedAt:new Date().toISOString(),issuedBy:String(actor||"admin"),note:String(note||"").trim().slice(0,300)};
 try{await inventory.submitTransaction([["update",{partitionKey:schoolId,rowKey:stock.rowKey,onHand:stock.onHand-record.quantity,reserved:reserved-own,unavailable},"Replace",{etag:stock.etag}],["create",ledger]])}
 catch(error){const committed=await getStaffIssueRow(inventory,schoolId,key);if(!compatible(committed,record,id)){if([409,412].includes(error.statusCode))fail("庫存或發放紀錄已更新，請重新整理後重試；不會重複扣庫存");throw error}return {ledger:committed,alreadyIssued:true}}
 return {ledger,alreadyIssued:false};
}

export async function syncCadreIssueLoan(loanClient,schoolId,record,ledger){
 if(record.category!=="CADRE_FIRST")return;
 const email=address(record.parentEmail),old=await getStaffIssueRow(loanClient,schoolId,email);
 if(old?.status==="ISSUED_LIFETIME"&&old.stockIssueId===ledger.rowKey)return;
 if(old&&(old.role!=="CADRE"||!["REQUESTED","ISSUED_LIFETIME"].includes(old.status)||old.size!==record.size))fail("庫存已發放，幹部領用紀錄待核對，請重新整理後重試同一筆需求");
 const next={...old,partitionKey:schoolId,rowKey:email,parentName:record.parentName||old?.parentName||"家長",studentId:record.studentId,role:"CADRE",size:record.size,status:"ISSUED_LIFETIME",issuedAt:ledger.issuedAt,requestedAt:old?.requestedAt||record.createdAt||ledger.issuedAt,returnedAt:"",stockIssueId:ledger.rowKey,updatedAt:new Date().toISOString()};
 if(old)await loanClient.updateEntity(next,"Replace",{etag:old.etag});else await loanClient.createEntity(next);
}
