// Bank account details are never stored in the public event config endpoint.
const moduleEl=document.getElementById("configModule");
const activityEl=document.getElementById("existingActivity");
const panel=document.getElementById("dinnerBankPanel");
const form=document.getElementById("dinnerBankForm");
const message=document.getElementById("dinnerBankStatus");
const fields=["bankName","bankCode","accountHolder","accountNumber"];
let current="";
async function refresh(){
 const dinner=moduleEl.value==="yearEndDinner";
 panel.hidden=!dinner;
 if(!dinner)return;
 const id=activityEl.value;current=id;
 form.querySelector("button").disabled=!id;
 if(!id){message.textContent="請先按上方「儲存設定」建立活動；儲存成功後會自動選取活動，再設定收款帳戶。";for(const f of fields)form.elements[f].value="";return}
 message.textContent="目前活動："+activityEl.selectedOptions[0]?.textContent+"；讀取收款帳戶中…";
 try{
  const res=await fetch("/api/uniform-events/dinner-payment-account?activityId="+encodeURIComponent(id),{credentials:"same-origin"});
  const data=await res.json();if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  if(current!==id)return;
  for(const f of fields)form.elements[f].value=data.item?.[f]||"";
  message.textContent=data.item?"已載入收款帳戶（僅管理員可查看）。":"尚未設定收款帳戶。";
 }catch(e){message.textContent="讀取失敗："+e.message}
}
moduleEl.addEventListener("change",()=>queueMicrotask(refresh));
activityEl.addEventListener("change",()=>queueMicrotask(refresh));
form.addEventListener("submit",async e=>{
 e.preventDefault();
 const id=activityEl.value;
 if(moduleEl.value!=="yearEndDinner"||!id){message.textContent="請先選取已儲存的期末聚餐活動";return}
 const payload={activityId:id};for(const f of fields)payload[f]=form.elements[f].value.trim();
 if(!confirm("確認儲存此期末聚餐的收款帳戶？帳戶只對管理員開放，尚未發布給家長。"))return;
 try{
  const res=await fetch("/api/uniform-events/dinner-payment-account",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await res.json();if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  message.textContent="收款帳戶已儲存，正在重新讀取資料驗證…";await refresh();if(!message.textContent.startsWith("已載入收款帳戶"))throw Error("已送出儲存，但重新讀取未確認成功："+message.textContent);message.textContent="已成功儲存並重新讀取收款帳戶（管理員專用）。家長端繳費功能尚未開放。";
 }catch(err){message.textContent="儲存或讀回驗證未完成："+err.message}
});
refresh();

const templateSelect=document.getElementById("bankTemplateSelect");
const templateForm=document.getElementById("bankTemplateForm");
let templates=[];
async function loadTemplates(){
 try{
  const response=await fetch("/api/uniform-events/payment-account-templates",{credentials:"same-origin"});
  const data=await response.json();if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  templates=data.items||[];
  const old=templateSelect.value;
  templateSelect.replaceChildren(new Option("手動輸入／建立新範本",""));
  for(const t of templates)templateSelect.add(new Option(t.label+(t.active?"":"（已停用）")+"｜"+t.bankName+" ****"+t.accountNumber.slice(-4),t.id));
  if(templates.some(t=>t.id===old))templateSelect.value=old;
 }catch(e){message.textContent="帳戶範本讀取失敗："+e.message}
}
templateSelect.addEventListener("change",()=>{
 const selected=templates.find(t=>t.id===templateSelect.value);
 if(!selected){templateForm.reset();return}
 for(const key of fields)form.elements[key].value=selected[key]||"";
 templateForm.elements.label.value=selected.label;
 templateForm.elements.active.value=String(selected.active);
 message.textContent="已帶入帳戶範本；如要套用到目前活動，請再按「儲存收款帳戶」。";
});
document.getElementById("reloadBankTemplates").addEventListener("click",loadTemplates);
templateForm.addEventListener("submit",async e=>{
 e.preventDefault();
 const payload={id:templateSelect.value||undefined,label:templateForm.elements.label.value.trim(),active:templateForm.elements.active.value==="true"};
 for(const key of fields)payload[key]=form.elements[key].value.trim();
 if(!confirm("儲存帳戶範本？已建立活動的收款帳戶不會自動變更。"))return;
 try{
  const response=await fetch("/api/uniform-events/payment-account-templates",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await response.json();if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  await loadTemplates();templateSelect.value=data.id;
  message.textContent="帳戶範本已儲存；活動帳戶未變更。若要套用，請按「儲存收款帳戶」。";
 }catch(err){message.textContent="範本儲存失敗："+err.message}
});
loadTemplates();
