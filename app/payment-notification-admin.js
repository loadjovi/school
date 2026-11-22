(()=>{
  let section=null,summary=null,sendButton=null,busy=false,refreshGeneration=0;
  let authorized=window.uniformFinanceWorkspace?.authorized===true;
  const isFinanceWorkspace=()=>window.uniformFinanceWorkspace?.isFinance===true||document.documentElement.classList.contains('finance-workspace');
  const canUse=()=>isFinanceWorkspace()&&authorized;
  const headers=()=>window.uniformEventAuthHeaders?.()||{};
  async function call(method="GET",body){
    if(!canUse())throw Error('僅指定財務幹部可查看及操作財務通知');
    const response=await fetch('/api/uniform-events/requests'+(method==="GET"?'?view=payment-notifications':''),{method,headers:{'Content-Type':'application/json',...headers()},credentials:'same-origin',cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'通知狀態讀取失敗');return data;
  }
  function text(data){
    const counts=`已通知 ${Number(data.sent||0)+Number(data.alreadySent||0)} 筆｜待寄 ${data.remaining||0} 筆｜失敗 ${data.failed||0} 筆｜待查 ${data.unconfirmed||0} 筆`;
    const f=data.financeNotification;
    const finance=f?`；財務通知：已通知 ${Number(f.sent||0)+Number(f.alreadySent||0)} 筆｜待寄 ${f.remaining||0} 筆｜失敗 ${f.failed||0} 筆｜待查 ${f.unconfirmed||0} 筆${f.noFinanceRecipients?"｜找不到有效財務後台帳號，請確認權限設定":""}`:'';
    const missing=finance+(data.missingRecipients?'｜'+data.missingRecipients+' 筆找不到可收信的家長，請核對綁定。':'');
    if(data.status==='disabled')return 'LAB 不對外寄信；可驗證通知範圍。'+counts+missing;
    if(data.status==='not_configured')return '寄信服務尚未完成設定，目前未寄出通知。'+counts+missing;
    return (data.deliveryPolicy==='line_first_email_fallback'?'LINE 優先；未受理者改寄 Email。':'')+counts+missing;
  }
  const statusLabel=status=>({SENT:'通知已受理',FAILED:'寄送失敗',SENDING:'寄送中／待確認',UNCONFIRMED:'結果待確認',OBSOLETE:'狀態已變更，未寄送',NOT_SENT:'尚未通知',PARTIAL:'部分通知已受理',NOT_REQUIRED:'無須催繳',MISSING_RECIPIENT:'尚無收件家長'})[status]||status;
  const timeLabel=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚無成功寄送紀錄';
  function renderHistories(data){
    let history=section.querySelector('#financeEmailHistory');if(!history){history=document.createElement('div');history.id='financeEmailHistory';section.append(history)}
    history.replaceChildren();
    for(const row of (data.financeStates||[]).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,30)){
      const p=document.createElement('p');p.textContent=`財務：${row.recipient}｜${statusLabel(row.status)}${row.channel?"（"+row.channel.toUpperCase()+"）":""}｜${timeLabel(row.updatedAt)}｜${row.sourceId}`;history.append(p);
    }
    let parentHistory=section.querySelector('#parentPaymentNoticeHistory');if(!parentHistory){parentHistory=document.createElement('div');parentHistory.id='parentPaymentNoticeHistory';section.append(parentHistory)}
    parentHistory.replaceChildren();
    for(const row of data.uniformStates){
      const card=document.createElement('details'),heading=document.createElement('summary');
      const label=window.uniformFinanceNoticeLabels?.[row.id]||'團服申請 '+row.id;
      heading.textContent=label+'｜'+statusLabel(row.status);card.append(heading);
      for(const recipient of row.recipients||[]){
        const p=document.createElement('p');p.textContent=`${recipient.recipient}｜${statusLabel(recipient.status)}${recipient.channel?'（'+recipient.channel.toUpperCase()+'）':''}｜${timeLabel(recipient.lastSentAt)}｜累計 ${Number(recipient.sentCount||0)} 次`;card.append(p);
      }
      if(['NOT_SENT','FAILED'].includes(row.status)){
        const retry=document.createElement('button');retry.type='button';retry.textContent='補送此筆繳款通知';
        retry.addEventListener('click',async()=>{
          if(!canUse()||busy)return;busy=true;retry.disabled=true;
          try{await window.finishPaymentNotificationBatches(await call('PATCH',{action:'SEND_PAYMENT_NOTICES',scope:{kind:'uniform',id:row.id},retryFailed:true}))}
          catch(error){if(summary&&canUse())summary.textContent='補送未完成：'+error.message}
          finally{busy=false;await refresh()}
        });card.append(retry);
      }
      if(!['NOT_REQUIRED','MISSING_RECIPIENT'].includes(row.status)){
        const reminder=document.createElement('button');reminder.type='button';reminder.disabled=!!row.reminderSentToday;reminder.textContent=row.reminderSentToday?'今日已通知':'再次提醒此家長';
        reminder.addEventListener('click',async()=>{
          if(!canUse()||busy)return;busy=true;reminder.disabled=true;
          try{await window.finishPaymentNotificationBatches(await call('PATCH',{action:'SEND_PAYMENT_REMINDER',id:row.id}))}
          catch(error){if(summary)summary.textContent='提醒未完成：'+error.message}
          finally{busy=false;await refresh()}
        });card.append(reminder);
      }
      parentHistory.append(card);
    }
  }
  async function refresh(){
    if(!canUse()||!section)return;
    const school=sessionStorage.getItem('school_context_id'),generation=++refreshGeneration;
    try{const data=await call();if(!canUse()||sessionStorage.getItem('school_context_id')!==school||generation!==refreshGeneration)return;
      if(!Array.isArray(data.uniformStates))throw Error(data.error||'通知明細未能讀取，請重試');
      summary.textContent=text(data);renderHistories(data);
      section.querySelector('#paymentEmailHeading').textContent='📨 繳費與財務通知';
      window.uniformPaymentEmailStates=Object.fromEntries(data.uniformStates.map(row=>[row.id,row]));
      window.dispatchEvent(new CustomEvent('paymentEmailStatesUpdated'));
    }catch(error){if(!canUse()||sessionStorage.getItem('school_context_id')!==school||generation!==refreshGeneration)return;summary.textContent=error.message;section.querySelector('#paymentEmailHeading').textContent='📨 財務通知｜紀錄暫時無法讀取';window.uniformPaymentEmailStates={};window.dispatchEvent(new CustomEvent('paymentEmailStatesUpdated'))}
  }
  window.refreshPaymentEmailStatus=refresh;
  window.paymentEmailSummaryText=text;
  window.finishPaymentNotificationBatches=async function(initial){
    // Operational actions trigger scoped notifications on the server. Summarize
    // their response without exposing finance history or finance resend APIs.
    if(!canUse())return initial;
    let current=initial,totalSent=Number(initial.sent||0),school=sessionStorage.getItem('school_context_id');
    try{
      for(let i=0;(current.remaining>0||current.financeNotification?.remaining>0)&&i<100&&!['disabled','not_configured','failed'].includes(current.status);i++){
        if(!canUse()||sessionStorage.getItem('school_context_id')!==school)throw Error('財務權限或學校情境已切換，停止寄送');
        if(summary)summary.textContent='正在寄送匯款通知…'+text({...current,sent:totalSent});
        current=await call('PATCH',{action:'SEND_PAYMENT_NOTICES',scope:initial.scope||{kind:'all'}});totalSent+=Number(current.sent||0);
      }
      const result={...current,sent:totalSent,alreadySent:Math.max(0,Number(current.alreadySent||0)-(totalSent-Number(current.sent||0)))};
      if(summary&&canUse())summary.textContent=text(result);await refresh();return result;
    }catch(error){const result={...current,status:'partial',sent:totalSent,failed:Number(current.failed||0)+1};if(summary&&canUse())summary.textContent='部分通知未確認，請重新讀取通知狀態。'+text(result);return result}
  };
  function mount(){
    if(!canUse()||section)return;
    const area=document.getElementById('financeNotificationsPanel')||document.getElementById('protectedAdminArea');if(!area)return;
    section=document.createElement('details');section.className='inline-finance';section.id='paymentEmailNotifications';section.open=true;
    section.innerHTML='<summary id="paymentEmailHeading">📨 繳費與財務通知</summary><p id="paymentEmailSummary" role="status">正在讀取通知紀錄…</p><button type="button" id="paymentEmailRefresh">更新紀錄</button> <button type="button" id="paymentEmailSend">補送尚未通知／失敗的提醒</button><p>LINE 優先；未受理時改寄 Email。已回報匯款或已核帳者不催繳。通知已受理不代表家長已閱讀。</p>';
    area.prepend(section);summary=section.querySelector('#paymentEmailSummary');sendButton=section.querySelector('#paymentEmailSend');
    section.querySelector('#paymentEmailRefresh').addEventListener('click',refresh);
    sendButton.addEventListener('click',async()=>{
      if(!canUse()||busy)return;busy=true;sendButton.disabled=true;summary.textContent='正在核對尚未通知的款項…';
      try{await window.finishPaymentNotificationBatches(await call('PATCH',{action:'SEND_PAYMENT_NOTICES',retryFailed:true}))}
      catch(error){if(summary&&canUse())summary.textContent='寄送未完成：'+error.message}
      finally{busy=false;if(canUse()){sendButton.disabled=false;await refresh()}}
    });
  }
  window.addEventListener('uniformAdminAuth',event=>{
    authorized=event.detail?.authenticated===true&&event.detail?.finance===true;
    if(canUse()){mount();section&&(section.hidden=false);refresh()}
    else{refreshGeneration++;if(section)section.hidden=true;window.uniformPaymentEmailStates={}}
  });
  window.addEventListener('uniformRequestsLoaded',()=>{if(canUse())refresh()});
  window.addEventListener('focus',()=>{if(canUse()&&sessionStorage.getItem('role_context')==='schoolAdmin')refresh()});
  setInterval(()=>{if(canUse()&&!document.hidden&&sessionStorage.getItem('role_context')==='schoolAdmin')refresh()},60000);
  if(canUse()){mount();refresh()}
})();
