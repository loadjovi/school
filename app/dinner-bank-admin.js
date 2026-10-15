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
 if(!confirm("確認儲存此期末聚餐的活動收款帳戶？若活動已啟用，新帳號將立即顯示給家長，請先核對資料。"))return;
 try{
  const res=await fetch("/api/uniform-events/dinner-payment-account",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
  const data=await res.json();if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  message.textContent="收款帳戶已儲存，正在重新讀取資料驗證…";await refresh();if(!message.textContent.startsWith("已載入收款帳戶"))throw Error("已送出儲存，但重新讀取未確認成功："+message.textContent);message.textContent="活動收款帳戶已儲存並完成讀回驗證；啟用家長端顯示後即開放報名與匯款。";window.dispatchEvent(new Event("dinnerBankAccountSaved"));
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
 templateForm.hidden=false;
 for(const key of fields)templateForm.elements[key].value=selected[key]||"";
 templateForm.elements.label.value=selected.label;
 templateForm.elements.active.value=String(selected.active);
 templateForm.querySelector("#templateSaveFeedback").textContent="已帶入範本，修改後按儲存；已綁定的活動帳戶不會自動更新。";
});
document.getElementById("reloadBankTemplates").addEventListener("click",loadTemplates);
templateForm.addEventListener("submit",async e=>{
 e.preventDefault();
 const payload={id:templateSelect.value||undefined,label:templateForm.elements.label.value.trim(),active:templateForm.elements.active.value==="true"};
 for(const key of fields)payload[key]=templateForm.elements[key].value.trim();
 if(!confirm("儲存內部帳戶範本？此範本僅供後台管理員選用，不會公布給家長，也不會自動變更已建立活動的收款帳戶。"))return;
 try{
  const response=await fetch("/api/uniform-events/payment-account-templates",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  await loadTemplates();templateSelect.value=data.id;
  templateForm.querySelector("#templateSaveFeedback").textContent="帳戶範本已儲存；期末聚餐可在活動設定選取帳戶，啟用時自動套用。已綁定的舊帳戶不會自動更新。";
 }catch(err){templateForm.querySelector("#templateSaveFeedback").textContent="範本儲存失敗："+err.message}
});
loadTemplates();

const bankEditor=document.getElementById("dinnerBankForm");
function showBankEditor(clear){if(!activityEl.value){message.textContent="請先儲存並選擇既有期末聚餐活動。";return}bankPanelExpanded=true;panel.hidden=false;bankEditor.hidden=false;if(clear)for(const f of fields)bankEditor.elements[f].value="";bankEditor.scrollIntoView({behavior:"smooth",block:"center"});}
document.getElementById("manageDinnerBank").addEventListener("click",()=>{if(moduleEl.value!=="yearEndDinner")return;bankPanelExpanded=!bankPanelExpanded;panel.hidden=!bankPanelExpanded;if(!bankPanelExpanded)return;panel.scrollIntoView({behavior:"smooth",block:"start"});message.textContent=activityEl.value?"請點選「新增帳戶」或「修改目前帳戶」。":"請先儲存此期末聚餐活動（保持關閉），再新增收款帳戶。";});
document.getElementById("bankAddNew").addEventListener("click",()=>showBankEditor(true));
document.getElementById("bankEditCurrent").addEventListener("click",()=>showBankEditor(false));
document.getElementById("bankTemplateToggle").addEventListener("click",()=>{templateForm.hidden=!templateForm.hidden;if(!templateForm.hidden){templateForm.scrollIntoView({behavior:"smooth",block:"center"});}});

function installQuickBankBinding(){
 const manage=document.getElementById("manageDinnerBank");
 if(!manage||document.getElementById("quickBankBinding"))return;
 const wrap=document.createElement("div");wrap.id="quickBankBinding";wrap.style.cssText="margin:12px 0;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff";
 const label=document.createElement("label");label.textContent="本活動收款帳戶（儲存活動設定時自動套用）";label.style.display="block";
 const select=document.createElement("select");select.style.cssText="display:block;width:100%;margin:8px 0";
 const status=document.createElement("p");status.setAttribute("role","status");
 label.appendChild(select);wrap.append(label,status);manage.insertAdjacentElement("afterend",wrap);
 let boundAccount=null,selectionActivityId="";
 const selectedTemplate=()=>templates.find(t=>t.id===select.value&&t.active);
 const validAccount=a=>a&&a.bankName&&a.accountHolder&&/^[0-9]{3}$/.test(a.bankCode||"")&&/^[0-9]{6,30}$/.test(a.accountNumber||"");
 window.dinnerBankSelection=()=>activityEl.value&&activityEl.value===selectionActivityId&&(selectedTemplate()||validAccount(boundAccount))||null;
 function syncVisibility(){
  const dinner=moduleEl.value==="yearEndDinner",available=!!window.dinnerBankSelection();
  const enabled=document.getElementById("config").elements.enabled;
  const showOption=[...enabled.options].find(o=>o.value==="true");
  if(showOption)showOption.disabled=dinner&&!available;
  wrap.hidden=!dinner;
  status.textContent=!dinner?"":!activityEl.value?selectedTemplate()?"已選擇帳戶；儲存新活動時會同步綁定，活動仍暫不顯示。":"可先選擇帳戶，再以「暫不顯示」儲存新活動。":selectedTemplate()?"已選擇帳戶；按「儲存活動設定」即綁定本活動。設定為「顯示」後同時開放報名與匯款。":validAccount(boundAccount)?"已綁定本活動收款帳戶；可設定為「顯示」。":"請選擇帳戶，才能設定家長端顯示。";
 }
 window.syncDinnerBankVisibility=syncVisibility;
 async function updateBound(){
  const id=activityEl.value;if(selectionActivityId&&selectionActivityId!==id)select.value="";selectionActivityId=id;boundAccount=null;fill();
  if(!id)return;
  try{const res=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin",headers:bankAuthHeaders()});const data=await res.json();if(id!==activityEl.value)return;if(!res.ok)throw Error(data.error||"HTTP "+res.status);boundAccount=data.item||null;fill();}catch(e){status.textContent="讀取目前活動帳戶失敗："+e.message}
 }
 function fill(){
  const previous=select.value;
  select.replaceChildren(new Option("請選擇已啟用的帳戶範本",""));
  for(const t of templates.filter(t=>t.active))select.add(new Option(t.label+"｜"+t.bankName+"（"+t.bankCode+"）末四碼 "+String(t.accountNumber).slice(-4),t.id));
  const matched=templates.find(t=>t.active&&boundAccount&&String(t.accountNumber)===String(boundAccount.accountNumber));
  if(templates.some(t=>t.active&&t.id===previous))select.value=previous;
  else if(matched)select.value=matched.id;
  syncVisibility();
 }
 window.applyDinnerBankSelection=async id=>{
  if(moduleEl.value!=="yearEndDinner"||selectionActivityId!==activityEl.value||(activityEl.value&&id!==activityEl.value))throw Error("請先選擇目前的期末聚餐活動。");
  const t=selectedTemplate(),target=t||boundAccount;
  if(!validAccount(target))throw Error("請先選擇有效的收款帳戶。");
  if(!boundAccount||fields.some(f=>String(boundAccount[f])!==String(target[f]))){
   const payload={activityId:id};for(const f of fields)payload[f]=target[f];
   const response=await fetch("/api/uniform-events/dinner-payment-account",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",...bankAuthHeaders()},body:JSON.stringify(payload)});
   const data=await response.json().catch(()=>({}));if(!response.ok)throw Error("綁定收款帳戶失敗："+(data.error||"HTTP "+response.status));
  }
  const verify=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin",cache:"no-store",headers:bankAuthHeaders()});
  const verified=await verify.json().catch(()=>({}));
  if(!verify.ok||!validAccount(verified.item)||fields.some(f=>String(verified.item[f])!==String(target[f])))throw Error("收款帳戶讀回驗證失敗，活動尚未啟用。"+(verified.error||""));
  boundAccount=verified.item;fill();
 };
 window.hasDinnerBankTemplateSelection=()=>!!selectedTemplate();
 select.addEventListener("change",syncVisibility);
 moduleEl.addEventListener("change",()=>queueMicrotask(fill));
 activityEl.addEventListener("change",()=>queueMicrotask(updateBound));
 window.addEventListener("uniformBankTemplatesLoaded",fill);
 window.addEventListener("dinnerBankAccountSaved",updateBound);
 fill();
 updateBound();
}
installQuickBankBinding();
