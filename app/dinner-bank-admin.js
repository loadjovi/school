// Bank account details are never stored in the public event config endpoint.
function bankAuthHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const roleContext=sessionStorage.getItem("role_context")||"";
 return {...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(schoolId?{"X-School-Id":schoolId}:{}),...(roleContext?{"X-Role-Context":roleContext}:{})};
}
const moduleEl=document.getElementById("configModule");
const activityEl=document.getElementById("existingActivity");
const panel=document.getElementById("dinnerBankPanel");
const form=document.getElementById("dinnerBankForm");
const message=document.getElementById("dinnerBankStatus");
const fields=["bankName","bankCode","accountHolder","accountNumber"];
let current="";
let bankPanelExpanded=false;
async function refresh(){
 const dinner=moduleEl.value==="yearEndDinner";
 panel.hidden=!dinner||!bankPanelExpanded;
 if(!dinner)return;
 const id=activityEl.value;current=id;
 form.querySelector("button").disabled=!id;
 if(!id){document.getElementById("bankCurrentSummary").textContent="請先儲存並選擇既有期末聚餐活動。";message.textContent="請先按上方「儲存設定」建立活動；儲存成功後會自動選取活動，再設定收款帳戶。";for(const f of fields)form.elements[f].value="";return}
 message.textContent="目前活動："+activityEl.selectedOptions[0]?.textContent+"；讀取收款帳戶中…";
 try{
  const res=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin",headers:bankAuthHeaders()});
  const data=await res.json();if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  if(current!==id)return;
  for(const f of fields)form.elements[f].value=data.item?.[f]||"";
  message.textContent=data.item?"已載入收款帳戶（僅管理員可查看）。":"尚未設定收款帳戶。";
  document.getElementById("bankCurrentSummary").textContent=data.item?"目前帳戶："+data.item.bankName+"（"+data.item.bankCode+"）｜"+data.item.accountHolder+"｜帳號末四碼 "+String(data.item.accountNumber||"").slice(-4):"尚未設定收款帳戶，請按「＋ 新增帳戶」。";
 }catch(e){message.textContent="讀取失敗："+e.message}
}
moduleEl.addEventListener("change",()=>queueMicrotask(refresh));
activityEl.addEventListener("change",()=>queueMicrotask(refresh));
form.addEventListener("submit",async e=>{
 e.preventDefault();
 const id=activityEl.value;
 if(moduleEl.value!=="yearEndDinner"||!id){message.textContent="請先選取已儲存的期末聚餐活動";return}
 const payload={activityId:id};for(const f of fields)payload[f]=form.elements[f].value.trim();
 if(!confirm("確認儲存此期末聚餐的活動收款帳戶？此帳戶將作為後續公布給家長匯款的資訊；目前尚不會自動發布。"))return;
 try{
  const res=await fetch("/api/uniform-events/dinner-payment-account",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
  const data=await res.json();if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  message.textContent="收款帳戶已儲存，正在重新讀取資料驗證…";await refresh();if(!message.textContent.startsWith("已載入收款帳戶"))throw Error("已送出儲存，但重新讀取未確認成功："+message.textContent);message.textContent="活動收款帳戶已儲存並完成讀回驗證，將作為後續提供家長匯款的資訊；目前尚未自動公布，家長端匯款回報與核帳功能尚未開放。";
 }catch(err){message.textContent="儲存或讀回驗證未完成："+err.message}
});
refresh();

const templateSelect=document.getElementById("bankTemplateSelect");
const templateForm=document.getElementById("bankTemplateForm");
let templates=[];
async function loadTemplates(){
 try{
  const response=await fetch("/api/uniform-events/payment-account-templates",{credentials:"same-origin",headers:bankAuthHeaders()});
  const data=await response.json();if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  templates=data.items||[];
  window.dispatchEvent(new Event("uniformBankTemplatesLoaded"));
  const old=templateSelect.value;
  templateSelect.replaceChildren(new Option("手動輸入／建立新範本",""));
  for(const t of templates)templateSelect.add(new Option(t.label+(t.active?"":"（已停用）")+"｜"+t.bankName+" ****"+t.accountNumber.slice(-4),t.id));
  if(templates.some(t=>t.id===old))templateSelect.value=old;
 }catch(e){message.textContent="帳戶範本讀取失敗："+e.message}
}
templateSelect.addEventListener("change",()=>{
 const selected=templates.find(t=>t.id===templateSelect.value);
 if(!selected){templateForm.reset();return}
 form.hidden=false;
 for(const key of fields)form.elements[key].value=selected[key]||"";
 templateForm.elements.label.value=selected.label;
 templateForm.elements.active.value=String(selected.active);
 message.textContent="已帶入內部帳戶範本；若要作為家長匯款資訊，請再按「儲存活動收款帳戶（供家長匯款）」。";
});
document.getElementById("reloadBankTemplates").addEventListener("click",loadTemplates);
templateForm.addEventListener("submit",async e=>{
 e.preventDefault();
 const payload={id:templateSelect.value||undefined,label:templateForm.elements.label.value.trim(),active:templateForm.elements.active.value==="true"};
 for(const key of fields)payload[key]=form.elements[key].value.trim();
 if(!confirm("儲存內部帳戶範本？此範本僅供後台管理員選用，不會公布給家長，也不會自動變更已建立活動的收款帳戶。"))return;
 try{
  const response=await fetch("/api/uniform-events/payment-account-templates",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  await loadTemplates();templateSelect.value=data.id;
  message.textContent="內部帳戶範本已儲存，僅供後台管理員使用，不會對家長公布；活動收款帳戶未變更。若要套用，請按「儲存活動收款帳戶（供家長匯款）」。";
 }catch(err){message.textContent="範本儲存失敗："+err.message}
});
loadTemplates();

const bankEditor=document.getElementById("dinnerBankForm");
function showBankEditor(clear){if(!activityEl.value){message.textContent="請先儲存並選擇既有期末聚餐活動。";return}bankPanelExpanded=true;panel.hidden=false;bankEditor.hidden=false;if(clear)for(const f of fields)bankEditor.elements[f].value="";bankEditor.scrollIntoView({behavior:"smooth",block:"center"});}
document.getElementById("manageDinnerBank").addEventListener("click",()=>{if(moduleEl.value!=="yearEndDinner")return;bankPanelExpanded=!bankPanelExpanded;panel.hidden=!bankPanelExpanded;if(!bankPanelExpanded)return;panel.scrollIntoView({behavior:"smooth",block:"start"});message.textContent=activityEl.value?"請點選「新增帳戶」或「修改目前帳戶」。":"請先儲存此期末聚餐活動（保持關閉），再新增收款帳戶。";});
document.getElementById("bankAddNew").addEventListener("click",()=>showBankEditor(true));
document.getElementById("bankEditCurrent").addEventListener("click",()=>showBankEditor(false));
document.getElementById("bankTemplateToggle").addEventListener("click",()=>{templateForm.hidden=!templateForm.hidden;if(!templateForm.hidden){form.hidden=false;templateForm.scrollIntoView({behavior:"smooth",block:"center"});}});

function installQuickBankBinding(){
 const manage=document.getElementById("manageDinnerBank");
 if(!manage||document.getElementById("quickBankBinding"))return;
 const wrap=document.createElement("div");wrap.id="quickBankBinding";wrap.style.cssText="margin:12px 0;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff";
 const label=document.createElement("label");label.textContent="選擇已建立的收款帳戶（綁定本活動）";label.style.display="block";
 const select=document.createElement("select");select.style.cssText="display:block;width:100%;margin:8px 0";
 const button=document.createElement("button");button.type="button";button.textContent="套用至目前期末聚餐";button.style.marginTop="6px";
 const status=document.createElement("p");status.setAttribute("role","status");
 label.appendChild(select);wrap.append(label,button,status);manage.insertAdjacentElement("afterend",wrap);
 let boundAccountNumber="";
 async function updateBound(){
  const id=activityEl.value;
  if(!id){boundAccountNumber="";fill();return}
  try{const res=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin",headers:bankAuthHeaders()});const data=await res.json();if(id!==activityEl.value)return;boundAccountNumber=res.ok?String(data.item?.accountNumber||""):"";fill();}catch(e){status.textContent="讀取目前活動帳戶失敗："+e.message}
 }
 function fill(){
  const previous=select.value;
  select.replaceChildren(new Option("請選擇已啟用的帳戶範本",""));
  for(const t of templates.filter(t=>t.active))select.add(new Option(t.label+"｜"+t.bankName+"（"+t.bankCode+"）末四碼 "+String(t.accountNumber).slice(-4),t.id));
  const matched=templates.find(t=>t.active&&String(t.accountNumber)===boundAccountNumber);
  if(templates.some(t=>t.active&&t.id===previous))select.value=previous;
  else if(matched)select.value=matched.id;
  const dinner=moduleEl.value==="yearEndDinner";wrap.hidden=!dinner;
  button.disabled=!dinner||!activityEl.value;
  status.textContent=!activityEl.value?"請先儲存並選取期末聚餐活動。":matched?"此活動已綁定帳戶："+matched.label+"；重新儲存設定不會取消綁定。":"選擇帳戶後按套用，才會建立活動收款關聯。";
 }
 button.addEventListener("click",async()=>{
  const id=activityEl.value,t=templates.find(x=>x.id===select.value&&x.active);
  if(!id||moduleEl.value!=="yearEndDinner"){status.textContent="請先儲存並選擇期末聚餐活動。";return}
  if(!t){status.textContent="請選擇已啟用的帳戶。";return}
  if(!confirm("將「"+t.label+"」綁定至目前期末聚餐？此操作不會自動對家長公布。"))return;
  button.disabled=true;status.textContent="正在儲存並驗證…";
  try{
   const payload={activityId:id};for(const f of fields)payload[f]=t[f];
   const response=await fetch("/api/uniform-events/dinner-payment-account",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"HTTP "+response.status);
   const verify=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin",headers:bankAuthHeaders()});
   const verified=await verify.json().catch(()=>({}));if(!verify.ok||!verified.item||String(verified.item.accountNumber)!==String(t.accountNumber))throw Error(verified.error||"儲存後讀回帳號未通過驗證");
   boundAccountNumber=String(t.accountNumber);
   status.textContent="已成功綁定此活動的收款帳戶；可再儲存活動設定。";
   await refresh();
  }catch(e){status.textContent="帳戶綁定失敗："+e.message}
  finally{button.disabled=false}
 });
 moduleEl.addEventListener("change",()=>queueMicrotask(fill));
 activityEl.addEventListener("change",()=>queueMicrotask(updateBound));
 window.addEventListener("uniformBankTemplatesLoaded",fill);
 fill();
 updateBound();
}
installQuickBankBinding();
