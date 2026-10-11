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
 if(!id){message.textContent="請先儲存活動，再從「編輯既有活動」選取該活動。";for(const f of fields)form.elements[f].value="";return}
 message.textContent="讀取收款帳戶中…";
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
  message.textContent="收款帳戶已儲存（管理員專用）；家長端繳費功能尚未開放。";
 }catch(err){message.textContent="儲存失敗："+err.message}
});
refresh();
