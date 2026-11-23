export const tshirtInventorySizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
export const openedStockKey=size=>"regular-opened:"+size;
export function tshirtInventoryView(rows,loans=[]){
 const items=[],opened=new Map(),ledgers=new Map(),movements=[];
 const entry=size=>{if(!opened.has(size))opened.set(size,{size,key:openedStockKey(size),onHand:0,borrowed:0,etag:null});return opened.get(size)};
 for(const row of rows){
  const key=String(row.rowKey||"");
  if(key.startsWith("regular:")||key.startsWith("competition:"))items.push({key,onHand:row.onHand,reserved:row.reserved,unavailable:row.unavailable,etag:row.etag});
  if(key.startsWith("regular-opened:")&&tshirtInventorySizes.includes(key.slice(15))){const value=entry(key.slice(15));value.onHand=row.onHand;value.etag=row.etag}
  if(key.startsWith("tshirt-loan:")&&row.parentEmail)ledgers.set(row.parentEmail.toLowerCase(),row);
  if(key.startsWith("po-received:")){
   let parts=[];try{parts=JSON.parse(row.breakdown||"[]")}catch{}
   movements.push({id:key,at:row.receivedAt,action:"採購單整單到貨",sizes:parts.map(x=>x.size+" × "+x.quantity).join("、"),quantity:row.addedQuantity,note:row.orderNumber+"；"+(row.creditedQuantity?"先前已入庫 "+row.creditedQuantity+" 件，本次不重複計入。":"")+(row.note||""),actor:row.receivedBy||""});
  }
  if(key.startsWith("received:")&&row.kind==="regularUniform"&&row.source!=="purchase_order"){
   let parts=[];try{parts=JSON.parse(row.breakdown||"[]")}catch{}
   if(!parts.length)parts=[{size:row.size,quantity:row.procurementQuantity||row.quantity}];
   movements.push({id:key,at:row.receivedAt,action:row.source==="existing_stock"?"使用現有庫存":"到貨入庫",sizes:parts.map(x=>x.size+" × "+x.quantity).join("、"),quantity:row.source==="existing_stock"?0:row.procurementQuantity||row.quantity,note:row.note||"",actor:row.receivedBy||""});
  }
  if(key.startsWith("issued:")&&row.kind==="regularUniform")movements.push({id:key,at:row.issuedAt,action:"實際發放",sizes:row.size,quantity:-row.quantity,note:row.note||"",actor:row.issuedBy||""});
  if((key.startsWith("staff-issued:")||key.startsWith("cadre-issued:"))&&row.kind==="regularUniform")movements.push({id:key,at:row.issuedAt,action:"幹部／志工實際發放",sizes:row.size,quantity:-row.quantity,note:(row.parentName?row.parentName+"；":"")+(row.note||""),actor:row.issuedBy||""});
  if(key.startsWith("opened-move:")||key.startsWith("volunteer-move:")){
   const transfer=row.action==="OPEN_FROM_NEW";
   movements.push({id:key,at:row.at,action:row.label,sizes:row.size+(transfer?" × "+row.quantity:""),quantity:transfer?null:row.delta,note:(transfer?"新團 T -"+row.quantity+"、已拆封 +"+row.quantity+"。":"")+(row.note||""),actor:row.actor||""});
  }
  if(key.startsWith("stock-count:")){
   let parts=[];try{parts=JSON.parse(row.details||"[]")}catch{}
   movements.push({id:key,at:row.at,action:"新團 T 盤點",sizes:parts.map(x=>x.key.replace("regular:","")+" = "+x.after.onHand).join("、"),quantity:null,note:"設定實際在庫總數",actor:row.actor||""});
  }
 }
 for(const loan of loans){const email=String(loan.parentEmail||loan.rowKey||"").toLowerCase();if(loan.role==="VOLUNTEER"&&!ledgers.has(email))ledgers.set(email,loan)}
 for(const loan of ledgers.values())if(["BORROWED","WASHING"].includes(loan.status)&&tshirtInventorySizes.includes(loan.size))entry(loan.size).borrowed++;
 return {items,openedItems:[...opened.values()].sort((a,b)=>tshirtInventorySizes.indexOf(a.size)-tshirtInventorySizes.indexOf(b.size)),movements:movements.filter(x=>x.at).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,60)};
}
