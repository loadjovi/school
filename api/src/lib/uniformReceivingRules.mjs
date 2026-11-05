const validDate=value=>typeof value==="string"&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)&&Number.isFinite(Date.parse(value));

export function taipeiReceiptDate(now=new Date()){
 return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(now));
}

export function statusAfterReceiving(status){
 return ["ORDERED","ARRIVED"].includes(status)?"READY_FOR_PICKUP":status;
}

export function normalizeReceivingDetails(input,now=new Date()){
 const useExistingStock=input?.useExistingStock===true;
 if(useExistingStock)return {
  useExistingStock:true,
  receivedDate:taipeiReceiptDate(now),
  note:"使用先前已盤點的現有庫存，不重複增加庫存"
 };
 const note=typeof input?.note==="string"?input.note.trim():"";
 const receivedDate=input?.receivedDate;
 if(!note||note.length>300||!validDate(receivedDate))throw Error("新貨到校時，請填寫實際到貨日期與驗收備註");
 return {useExistingStock:false,receivedDate,note};
}
