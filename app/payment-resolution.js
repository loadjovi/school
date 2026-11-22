(()=>{
 "use strict";
 if(window.paymentResolutionUI)return;
 const enabled=()=>document.documentElement.hasAttribute("data-payment-resolution");
 const active=new Set(["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED","REFUND_REQUESTED"]),busy=new Set(),outcomes=new Map();
 const labels={ADJUSTMENT_REQUIRED:"金額待處理，流程暫停",SUPPLEMENT_REPORTED:"已回報補款，待財務核帳",REFUND_REQUESTED:"已申請退費，待財務處理",REFUNDED:"已退款，申請已作廢",VERIFIED:"已足額核帳"};
 const money=n=>"NT$ "+Number(n||0).toLocaleString("zh-TW");
 function node(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e}
 function field(form,label,name,{type="text",value="",required=true,max=300}={}){
  const wrap=node("label",label),input=node(type==="textarea"?"textarea":"input");if(type!=="textarea")input.type=type;
  input.name=name;input.value=String(value);input.required=required;if(type==="number"){input.min="0";input.max="10000000";input.step="1"}else input.maxLength=max;
  if(type==="checkbox"){input.checked=false;input.value="true"}wrap.append(input);form.append(wrap);return input;
 }
 function bankFields(form){field(form,"退款銀行代碼（3 碼）","bankCode",{max:3});field(form,"退款帳號","accountNumber",{max:30});field(form,"退款戶名","accountHolder",{max:100})}
 function details(host,title){const d=node("details"),s=node("summary",title);d.append(s);host.append(d);return d}
 const notice=n=>({accepted:"LINE 已受理，本次不寄 Email",email_sent:"LINE 未受理，備援 Email 已受理",mixed_sent:"LINE／備援 Email 已分別受理",email_missing:"通知未完成：缺少可收信 Email",email_not_configured:"通知未完成：Email 服務尚未設定"}[n?.status]||"通知結果請至紀錄核對");
 function actionForm(host,item,action,label,api,refresh,confirmation,configure){
  const form=node("form");configure(form);const button=node("button",label),message=node("p");button.type="submit";message.setAttribute("role","status");form.append(button,message);host.append(form);
  form.addEventListener("submit",async event=>{
   event.preventDefault();const key=item.sourceType+":"+item.id;if(busy.has(key))return;
   if(!confirm(confirmation))return;
   const values=Object.fromEntries(new FormData(form).entries());
   for(const key of ["receivedAmount","amount","refundAmount"])if(key in values)values[key]=Number(values[key]);
   if("refundExecuted" in values)values.refundExecuted=values.refundExecuted==="true";
   busy.add(key);button.disabled=true;message.textContent="正在處理…";
   try{const result=await api("uniform-events/payment-resolution",{method:"PATCH",body:JSON.stringify({...values,sourceType:item.sourceType,id:item.id,action,requestId:crypto.randomUUID(),etag:item.etag,revision:item.paymentResolution?.revision})});message.textContent="已儲存。"+notice(result.notification);outcomes.set(key,message.textContent);await refresh();const status=document.getElementById?.("inlineFinanceStatus");if(status)status.textContent=outcomes.get(key)+"。"+status.textContent;}
   catch(error){message.textContent=error.message+"；請重新讀取核對，勿重複匯款或退款。"}
   finally{busy.delete(key);button.disabled=false}
  });return form;
 }
 function summary(host,item){
  const r=item.paymentResolution;if(!r)return;
  if(outcomes.has(item.sourceType+":"+item.id))host.append(node("p",outcomes.get(item.sourceType+":"+item.id)));
  host.append(node("strong",labels[item.paymentStatus]||"款項處理紀錄"),node("p","應繳 "+money(r.expectedAmount)+"｜銀行確認累計實收 "+money(r.receivedAmount)));
  if(active.has(item.paymentStatus))host.append(node("p",r.balance>0?"尚待補繳："+money(r.balance):r.balance<0?"溢繳差額："+money(-r.balance):"待財務結案"),node("p","核帳完成前，不會進入採購、發放或報名完成。"));
  if(r.reason)host.append(node("p","財務說明："+r.reason));
  if(r.supplement)host.append(node("p","最近補款回報："+money(r.supplement.amount)+"｜"+r.supplement.transferDate+"｜末五碼 "+r.supplement.lastFive));
  if(r.refund)host.append(node("p","已退款 "+money(r.refund.amount)+"｜"+r.refund.date+(item.paymentStatus==="REFUNDED"?"｜原申請已作廢":"｜溢繳已退還")));
  const events=item.paymentResolutionEvents||[];
  if(events.length){const log=details(host,"查看款項處理紀錄");for(const event of events)log.append(node("p",new Date(event.at).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false})+"｜"+({REQUEST_ADJUSTMENT:"財務通知差額",REPORT_SUPPLEMENT:"家長回報補款",REQUEST_REFUND:"家長申請退費",UPDATE_REFUND_ACCOUNT:"更新退款帳戶",VERIFY_ADJUSTMENT:"財務確認足額",COMPLETE_REFUND:"完成退款並作廢",REFUND_EXCESS:"退還溢繳並核帳"}[event.action]||"款項處理")+(event.reason?"｜"+event.reason:"")))}
 }
 function parentCard(item,api,refresh){
  const card=node("section");card.className="payment-resolution-card";card.id="payment-resolution-"+item.sourceType+"-"+item.id;
  card.append(node("h3",(item.title||"款項處理")+(item.studentNames?.length?"｜"+item.studentNames.join("、"):"")));summary(card,item);
  const r=item.paymentResolution;
  if(item.paymentStatus==="ADJUSTMENT_REQUIRED"&&r.balance>0){
   const bank=item.paymentAccount;
   if(bank?.accountNumber)card.append(node("p","補款帳戶："+bank.bankName+"（"+bank.bankCode+"）｜"+bank.accountHolder+"｜"+bank.accountNumber));
   else card.append(node("p","收款帳戶尚未確認，請先聯絡財務；勿自行匯款。"));
   if(bank?.accountNumber)actionForm(details(card,"我已補繳差額"),item,"REPORT_SUPPLEMENT","送出補款回報",api,refresh,"確認已完成差額匯款，送出後仍需財務核帳？",form=>{
    field(form,"本次補繳金額","amount",{type:"number",value:r.balance});field(form,"補款日期","transferDate",{type:"date"});field(form,"匯出帳號末五碼","lastFive",{max:5});
   });
  }
  if(["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus))actionForm(details(card,"不同意補款，申請退費並取消"),item,"REQUEST_REFUND","申請退費並取消",api,refresh,"確定申請退費並取消？財務完成退款後，原申請將作廢。",form=>{
   form.append(node("p","申請送出後，請等待財務實際退款；不會立即作廢。"));field(form,"退費原因","reason",{type:"textarea"});bankFields(form);
  });
  if(item.paymentStatus==="REFUND_REQUESTED"){
   card.append(node("p","退費原因："+r.refundRequest.reason));
   if(r.refundRequest.bank)card.append(node("p","退款帳戶已提供：銀行 "+r.refundRequest.bank.bankCode+"｜末四碼 "+r.refundRequest.bank.accountNumber.slice(-4)+"；財務完成退款後才會作廢。"));
   else card.append(node("p","請先提供退款帳戶，財務才能辦理退款。"));
   actionForm(details(card,r.refundRequest.bank?"更正退款帳戶":"填寫退款帳戶"),item,"UPDATE_REFUND_ACCOUNT","儲存退款帳戶",api,refresh,"確定提供此退款帳戶給財務？",bankFields);
  }
  return card;
 }
 function financeControls(host,item,sourceType,api,refresh){
  if(!enabled())return;item={...item,sourceType};const r=item.paymentResolution;
  const section=node("section");section.className="payment-resolution-card";host.append(section);summary(section,item);
  if(item.paymentStatus==="REFUND_REQUESTED"){
   const bank=r.refundRequest.bank;
   section.append(node("p","家長退費原因："+r.refundRequest.reason));
   if(!bank){section.append(node("p","家長尚未提供退款帳戶；請家長至平台補齊。"));return}
   section.append(node("p","退款帳戶："+bank.bankCode+"｜"+bank.accountNumber+"｜"+bank.accountHolder));
   actionForm(section,item,"COMPLETE_REFUND","登錄已退款，並作廢申請",api,refresh,"此操作只登錄已完成的銀行退款。確認已實際退款，且要作廢原申請？",form=>{
    form.append(node("p","請先核對所有入帳（含後續補款），在銀行完成退款後再登錄。此按鈕不會自動匯款。"));
    field(form,"銀行確認累計實收總額（含補款）","receivedAmount",{type:"number",value:r.receivedAmount});field(form,"實際退還總額","refundAmount",{type:"number",value:r.receivedAmount});field(form,"銀行退款日期","refundDate",{type:"date"});field(form,"退款憑據／交易編號","reference",{max:100});field(form,"退款查核備註","note",{type:"textarea"});field(form,"我已在銀行完成退款並核對憑據","refundExecuted",{type:"checkbox"});
   });return;
  }
  if(!["REPORTED_UNVERIFIED","ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus)&&!(sourceType==="staff"&&item.paymentStatus==="AWAITING_TRANSFER"))return;
  const adjust=details(section,"金額不符：通知補款／差額");
  actionForm(adjust,item,"REQUEST_ADJUSTMENT","通知家長並暫停流程",api,refresh,"確認依銀行實收金額通知家長處理差額？原申請會暫停，不會核帳或採購。",form=>{
   form.append(node("p","填累計實收，不是本次匯款。例：應繳 400、銀行已收 300，系統通知補繳 100。"));
   field(form,"銀行確認累計實收總額","receivedAmount",{type:"number",value:r?.receivedAmount??item.transferReport?.amount??0});field(form,"銀行實際入帳日期","bankPostedAt",{type:"date"});field(form,"給家長的說明","reason",{type:"textarea",value:r?.reason||""});
  });
  if(["ADJUSTMENT_REQUIRED","SUPPLEMENT_REPORTED"].includes(item.paymentStatus))actionForm(details(section,"已收足款項：重新核帳"),item,"VERIFY_ADJUSTMENT","確認足額入帳，恢復流程",api,refresh,"確認銀行累計實收等於應繳總額？核帳後將恢復採購／完成報名。",form=>{
   field(form,"銀行確認累計實收總額","receivedAmount",{type:"number",value:r.expectedAmount});field(form,"最後入帳日期","bankPostedAt",{type:"date"});field(form,"核帳備註","note",{type:"textarea"});
  });
  if(item.paymentStatus==="ADJUSTMENT_REQUIRED"&&r.balance<0)actionForm(details(section,"已退還溢繳：保留申請並核帳"),item,"REFUND_EXCESS","登錄已退溢繳並核帳",api,refresh,"確認已在銀行退還溢繳，保留原申請並核帳？",form=>{
   field(form,"銀行確認累計實收總額","receivedAmount",{type:"number",value:r.receivedAmount});field(form,"已退還溢繳金額","refundAmount",{type:"number",value:-r.balance});field(form,"退款日期","refundDate",{type:"date"});field(form,"退款憑據編號","reference",{max:100});field(form,"備註","note",{type:"textarea"});field(form,"我已在銀行完成退款並核對憑據","refundExecuted",{type:"checkbox"});
  });
 }
 async function loadParent(host,api,refresh,{historyHost}={}){
  if(!host||!enabled())return;host.hidden=false;host.replaceChildren(node("p","正在讀取補款與退費進度…"));
  if(historyHost){historyHost.replaceChildren();historyHost.hidden=true}
  try{const data=await api("uniform-events/payment-resolution"),items=data.items||[];host.replaceChildren();if(!items.length){host.hidden=true;return}
   const pending=items.filter(item=>active.has(item.paymentStatus)),options={historyHost};
   const reload=async()=>{await loadParent(host,api,refresh,options);if(refresh)await refresh()};
   host.hidden=!!historyHost&&!pending.length;
   if(!host.hidden){host.append(node("h2",historyHost?"待處理款項（"+pending.length+"）":"補款與退費"));const update=node("button","更新");update.type="button";update.onclick=()=>loadParent(host,api,refresh,options);host.append(update)}
   for(const item of pending)host.append(parentCard(item,api,reload));
   const closed=items.filter(item=>!active.has(item.paymentStatus));if(closed.length){const target=historyHost||host;target.hidden=false;const archive=details(target,"補款／退費已結案（"+closed.length+"）");for(const item of closed)archive.append(parentCard(item,api,reload))}
  }catch(error){host.hidden=false;host.replaceChildren(node("p","補款與退費進度暫時無法讀取："+error.message));const retry=node("button","重新讀取");retry.type="button";retry.onclick=()=>loadParent(host,api,refresh,{historyHost});host.append(retry)}
 }
 window.paymentResolutionUI={enabled,active,labels,financeControls,loadParent};
 const style=node("style");style.textContent=".payment-resolution-card{border:1px solid #d3a967;border-radius:12px;background:#fffaf0;padding:14px;margin:12px 0;overflow-wrap:anywhere}.payment-resolution-card details{margin-top:12px;padding:10px;border:1px solid #ddd;border-radius:8px}.payment-resolution-card summary{cursor:pointer;font-weight:700}.payment-resolution-card form{display:grid;gap:10px;margin-top:12px}.payment-resolution-card label{display:block}.payment-resolution-card input:not([type=checkbox]),.payment-resolution-card textarea{display:block;width:100%;max-width:100%;box-sizing:border-box;padding:10px;margin-top:5px;font:inherit;border:1px solid #aab8bd;border-radius:7px}.payment-resolution-card input[type=checkbox]{margin-left:8px}.payment-resolution-card button{min-height:44px;white-space:normal;padding:10px 14px;max-width:100%}";document.head.append(style);
})();
