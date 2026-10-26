// Server order/payment fields remain authoritative; viewing a notice never
// dismisses an unpaid order.
(()=>{
  const kinds=new Set(["regularUniform","competitionUniform"]);
  const openStatuses=new Set(["APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"]);
  function eligible(item){return kinds.has(item?.kind)&&openStatuses.has(item.status)&&item.acquisition!=="PUBLIC"&&Number.isSafeInteger(item.amount)&&item.amount>0}
  function due(item){return eligible(item)&&["","AWAITING_TRANSFER"].includes(String(item.paymentStatus||""))}
  function reported(item){return eligible(item)&&item.paymentStatus==="REPORTED_UNVERIFIED"}
  function alerts(items){
    const rows=(items||[]).filter(item=>due(item)||reported(item)).sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")));
    return {due:rows.filter(due),reported:rows.filter(reported)};
  }
  function stage(item){
    if(!kinds.has(item?.kind)||item.status!=="APPROVED"||item.acquisition==="PUBLIC")return null;
    if(due(item))return {title:"已核准，待匯款",next:"請先完成匯款，再回報匯款日期與轉出帳號末五碼，送出後等待財務核帳。"};
    if(reported(item))return {title:"已回報匯款，待財務核帳",next:"匯款資料已送出，請等待學校確認入帳；無須重複匯款或回報。"};
    if(item.paymentStatus==="VERIFIED")return {title:"已確認入帳，等待統一採購",next:"財務已確認入帳，請等待學校安排採購及後續到貨通知。"};
    if(!Number.isSafeInteger(item.amount)||item.amount<=0)return {title:"已核准，待學校確認應繳金額",next:"請等待學校補正應繳金額，確認收款資訊後再匯款。"};
    return null;
  }
  window.uniformPaymentState={due,reported,alerts,stage};
})();
