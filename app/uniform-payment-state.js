// Server order/payment fields remain authoritative; viewing a notice never
// dismisses an unpaid order.
(()=>{
  const kinds=new Set(["regularUniform","competitionUniform"]);
  const openStatuses=new Set(["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"]);
  function family(item){return ["fieldTrip","yearEndDinner"].includes(item?.kind)}
  function held(item){return item?.canResolvePayment!==false&&Boolean(item?.paymentResolution)&&["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED"].includes(item.paymentStatus)}
  function eligible(item){return (family(item)?item.registrationStatus==="REGISTERED"&&item.paymentOpen===true:kinds.has(item?.kind)&&openStatuses.has(item.status)&&item.acquisition!=="PUBLIC")&&Number.isSafeInteger(item.amount)&&item.amount>0}
  function due(item){return eligible(item)&&!held(item)&&(family(item)?["","NOT_OPEN","AWAITING_TRANSFER"].includes(String(item.paymentStatus||"")):["","AWAITING_TRANSFER"].includes(String(item.paymentStatus||"")))}
  function reported(item){return eligible(item)&&item.paymentStatus==="REPORTED_UNVERIFIED"}
  function alerts(items){
    const rows=(items||[]).filter(item=>due(item)||reported(item)||held(item)).sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
    const holds=rows.filter(held);return {due:rows.filter(due),reported:rows.filter(reported),...(holds.length?{held:holds}:{})};
  }
  function stage(item){
    if(item?.paymentResolution&&["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED","REFUNDED"].includes(item.paymentStatus))return {title:({ADJUSTMENT_REQUIRED:"待處理差額，流程暫停",SUPPLEMENT_REPORTED:"已補款，待財務核帳",REFUND_REQUESTED:"已申請退費，待財務處理",REFUNDED:"已退款，申請已作廢"})[item.paymentStatus],next:"請至「補款與退費」查看金額及處理進度。"};
    if(!kinds.has(item?.kind)||item.status!=="APPROVED"||item.acquisition==="PUBLIC")return null;
    if(due(item))return {title:"已核准，待匯款",next:"請先完成匯款，再回報匯款日期與轉出帳號末五碼，送出後等待財務核帳。"};
    if(reported(item))return {title:"已回報匯款，待財務核帳",next:"匯款資料已送出，請等待學校確認入帳；無須重複匯款或回報。"};
    if(item.paymentStatus==="VERIFIED")return {title:"已確認入帳，等待統一採購",next:"財務已確認入帳，請等待學校安排採購及後續到貨通知。"};
    if(!Number.isSafeInteger(item.amount)||item.amount<=0)return {title:"已核准，待學校確認應繳金額",next:"請等待學校補正應繳金額，確認收款資訊後再匯款。"};
    return null;
  }
  window.uniformPaymentState={due,reported,alerts,stage,family,held};
})();
