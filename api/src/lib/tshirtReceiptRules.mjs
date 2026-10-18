// Pure first-public T-shirt handoff and receipt rules.
export const TSHIRT_SIZES=new Set(["8","10","12","XS","S","M","L","XL","2L","3L","5L"]);
export function isFirstTshirtHandoffEligible(record){
 return Boolean(record)&&record.historicalIssued!==true&&record.received!==true
  &&Number(record.issuedQuantity||0)===0&&record.source==="PARENT_SIZE_SURVEY"
  &&TSHIRT_SIZES.has(record.size)&&!record.schoolIssuedAt;
}
export function isFirstTshirtReceiptEligible(record){
 return Boolean(record)&&record.historicalIssued!==true&&record.received!==true
  &&Number(record.issuedQuantity||0)===0&&record.source==="PARENT_SIZE_SURVEY"
  &&TSHIRT_SIZES.has(record.size)&&Boolean(record.schoolIssuedAt)
  &&record.schoolIssuedSize===record.size&&record.schoolIssuedQuantity===1;
}
export function buildSchoolHandoffPayload(record,actor,at,recipient){
 if(!isFirstTshirtHandoffEligible(record))throw Error("Cannot hand over unsized or already issued T-shirt");
 const name=String(recipient||"").trim();
 if(!name||name.length>100)throw Error("Recipient required");
 return {...record,schoolIssuedAt:at,schoolIssuedBy:actor,schoolIssuedSize:record.size,
  schoolIssuedQuantity:1,schoolHandoffTo:name,updatedAt:at};
}
export function buildFirstReceiptPayload(record,actor,at){
 if(!isFirstTshirtReceiptEligible(record))throw Error("School handoff must precede parent acknowledgement");
 return {...record,historicalIssued:true,issuedQuantity:1,received:true,
  receivedSize:record.size,receivedAt:at,receivedBy:actor,
  source:"PARENT_CONFIRMED_FIRST_PUBLIC",updatedAt:at};
}
