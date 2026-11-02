export const tshirtPurchaseOrderSizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];

export function normalizePurchaseOrderItems(items){
 if(!Array.isArray(items))throw Error("採購尺碼明細不可空白");
 const seen=new Set(),normalized=[];
 for(const row of items){
  const size=String(row?.size||"").trim().toUpperCase(),quantity=Number(row?.quantity);
  if(!tshirtPurchaseOrderSizes.includes(size)||!Number.isSafeInteger(quantity)||quantity<1||quantity>100||seen.has(size))throw Error("採購尺碼或件數不正確");
  seen.add(size);normalized.push({size,quantity});
 }
 const total=normalized.reduce((sum,row)=>sum+row.quantity,0);
 if(total<10)throw Error("團 T 每次採購至少 10 件");
 if(total>500)throw Error("單張採購單最多 500 件");
 return {items:normalized,total};
}

export function validatePurchaseOrderInput(input){
 const schoolYear=Number(input?.schoolYear),semester=Number(input?.semester),pendingUnknownUnits=Number(input?.pendingUnknownUnits||0);
 if(!Number.isSafeInteger(schoolYear)||schoolYear<100||schoolYear>200||![1,2].includes(semester))throw Error("請確認採購學年度與學期");
 if(!Number.isSafeInteger(pendingUnknownUnits)||pendingUnknownUnits<0||pendingUnknownUnits>500)throw Error("待填尺寸件數不正確");
 if(pendingUnknownUnits>0&&input?.acknowledgePendingSize!==true)throw Error("仍有待填尺寸需求，請確認本採購單暫不包含該件");
 const order=normalizePurchaseOrderItems(input?.items);
 return {...order,schoolYear,semester,pendingUnknownUnits};
}
