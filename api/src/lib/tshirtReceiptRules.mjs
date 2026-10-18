// Pure receipt rules shared by Azure function and regression tests.
export const TSHIRT_SIZES=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
export function isFirstTshirtReceiptEligible(record){
 return Boolean(record)&&record.historicalIssued!==true&&record.received!==true&&Number(record.issuedQuantity||0)===0&&record.source==="PARENT_SIZE_SURVEY"
  &&TSHIRT_SIZES.has(record.size);
}
export function buildFirstReceiptPayload(record,actor,at){
 if(!isFirstTshirtReceiptEligible(record))throw Error("Cannot confirm a second or unsized issue");
 return {...record,historicalIssued:true,issuedQuantity:1,received:true,
  receivedSize:record.size,receivedAt:at,receivedBy:actor,
  source:"PARENT_CONFIRMED_FIRST_PUBLIC",updatedAt:at};
}
