(()=>{
  const area=document.getElementById("protectedAdminArea");if(!area)return;
  const section=document.createElement("details");section.className="inline-finance";section.id="paymentEmailNotifications";
  section.innerHTML='<summary>📧 匯款 Email 通知</summary><p>核准自費團服、開放活動收款時，自動寄信引導家長登入平台。已回報或已核帳不催繳；餐會開放時通知尚未報名家庭。</p><p id="paymentEmailSummary" role="status">等待管理員登入驗證…</p><button type="button" id="paymentEmailRefresh">重新讀取通知狀態</button> <button type="button" id="paymentEmailSend">補寄尚未通知／失敗的匯款提醒</button><p>同一筆款項與金額不重複寄給同一家長。寄送結果不明的紀錄保留待查，請先核對，避免重寄。</p>';
  area.prepend(section);
  const summary=section.querySelector('#paymentEmailSummary'),sendButton=section.querySelector('#paymentEmailSend');let busy=false;
  const headers=()=>window.uniformEventAuthHeaders?.()||{};
  async function call(method="GET",body){
    const response=await fetch('/api/uniform-events/requests'+(method==="GET"?'?view=payment-notifications':''),{method,headers:{'Content-Type':'application/json',...headers()},credentials:'same-origin',cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'通知狀態讀取失敗');return data;
  }
  function text(data){
    const counts=`已通知 ${Number(data.sent||0)+Number(data.alreadySent||0)} 筆｜待寄 ${data.remaining||0} 筆｜失敗 ${data.failed||0} 筆｜待查 ${data.unconfirmed||0} 筆`;
    const missing=data.missingRecipients?'｜'+data.missingRecipients+' 筆找不到可收信的家長，請核對綁定。':'';
    if(data.status==='disabled')return 'LAB 不對外寄信；可驗證通知範圍。'+counts+missing;
    if(data.status==='not_configured')return '寄信服務尚未完成設定，目前未寄出通知。'+counts+missing;
    return counts+missing;
  }
  async function refresh(){try{const data=await call();summary.textContent=text(data)}catch(error){summary.textContent=error.message}}
  window.paymentEmailSummaryText=text;
  window.finishPaymentNotificationBatches=async function(initial){
    let current=initial,totalSent=Number(initial.sent||0),school=sessionStorage.getItem('school_context_id');
    try{
      for(let i=0;current.remaining>0&&i<100&&!['disabled','not_configured','failed'].includes(current.status);i++){
        if(sessionStorage.getItem('school_context_id')!==school)throw Error('學校情境已切換，停止寄送');
        summary.textContent='正在寄送匯款通知…'+text({...current,sent:totalSent});
        current=await call('PATCH',{action:'SEND_PAYMENT_NOTICES',scope:initial.scope||{kind:'all'}});totalSent+=Number(current.sent||0);
      }
      const result={...current,sent:totalSent,alreadySent:Math.max(0,Number(current.alreadySent||0)-(totalSent-Number(current.sent||0)))};
      summary.textContent=text(result);return result;
    }catch(error){const result={...current,status:'partial',sent:totalSent,failed:Number(current.failed||0)+1};summary.textContent='部分通知未確認，請重新讀取通知狀態。'+text(result);return result}
  };
  section.querySelector('#paymentEmailRefresh').addEventListener('click',refresh);
  sendButton.addEventListener('click',async()=>{
    if(busy)return;busy=true;sendButton.disabled=true;summary.textContent='正在核對尚未通知的款項…';
    try{await window.finishPaymentNotificationBatches(await call('PATCH',{action:'SEND_PAYMENT_NOTICES',retryFailed:true}))}
    catch(error){summary.textContent='寄送未完成：'+error.message}
    finally{busy=false;sendButton.disabled=false}
  });
  window.addEventListener('uniformAdminAuth',event=>{if(event.detail?.authenticated)refresh()});
  if(sessionStorage.getItem('role_context')==='schoolAdmin')refresh();
})();
