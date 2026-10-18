const $=id=>document.getElementById(id);
const sizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
function headers(){const token=sessionStorage.getItem("google_id_token")||"";const school=sessionStorage.getItem("school_context_id")||"";const role=sessionStorage.getItem("role_context")||"";return {"Content-Type":"application/json",...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(school?{"X-School-Id":school}:{}),...(role?{"X-Role-Context":role}:{})}}
async function api(method,body){const r=await fetch("/api/uniform-events/tshirt-historical-size",{method,credentials:"same-origin",cache:"no-store",headers:headers(),...(body?{body:JSON.stringify(body)}:{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"HTTP "+r.status);return d}
async function load(){
 const data=await api("GET");$("items").replaceChildren();
 if(!data.items?.length){$("items").textContent="目前沒有需要登錄團 T 尺寸的孩子。";return}
 for(const item of data.items){
  const article=document.createElement("article"),heading=document.createElement("p"),label=document.createElement("label"),select=document.createElement("select"),button=document.createElement("button"),info=document.createElement("p");
  heading.textContent=(item.studentName||"已綁定學生")+"｜"+(item.historicalIssued===true?"已配發團 T 1 件":"尚未領取團 T，先登錄尺寸");
  label.textContent=item.historicalIssued===true?"已領取團 T 尺寸：":"預計首次公費領用團 T 尺寸：";for(const size of sizes){const o=document.createElement("option");o.value=size;o.textContent=size;select.append(o)}
  if(item.size)select.value=item.size;else{const o=document.createElement("option");o.value="";o.textContent="請選擇尺寸";o.selected=true;o.disabled=true;select.prepend(o)}
  button.textContent="儲存尺寸";button.type="button";info.textContent=item.size?"已登錄："+item.size:"尺寸待補登";
  button.addEventListener("click",async()=>{if(!select.value)return;button.disabled=true;try{await api("PATCH",{studentId:item.studentId,size:select.value,etag:item.etag});$("status").textContent="尺寸已儲存";await load()}catch(e){$("status").textContent="儲存失敗："+e.message}finally{button.disabled=false}});
  label.append(select);article.append(heading,label,button,info);
  if(item.historicalIssued!==true){
   const status=document.createElement("p");status.className="hint";status.textContent=!item.size?"請先儲存尺寸，再等待學校發放。":item.schoolIssuedAt?"學校已確認發放，請在學生實際收到團 T 後確認。":"尺寸已登錄，待學校確認交付後才能完成領取。";
   article.append(status);
   if(item.size&&item.schoolIssuedAt){
    const confirmButton=document.createElement("button");confirmButton.type="button";confirmButton.textContent="我已收到團 T｜確認領取 1 件";
    confirmButton.addEventListener("click",async()=>{
     if(!confirm("請核對學生已實際收到團 T 1 件，尺寸 "+item.size+"。確認後將登記首次公費領取，確定嗎？"))return;
     confirmButton.disabled=true;
     try{
      await api("PATCH",{studentId:item.studentId,action:"CONFIRM_FIRST_RECEIPT",receivedSize:item.size,confirmedReceived:true,etag:item.etag});
      $("status").textContent="已確認實際領取團 T";await load();
     }catch(error){$("status").textContent="領取確認失敗："+error.message;confirmButton.disabled=false}
    });
    article.append(confirmButton);
   }
  }else if(item.receivedAt){
   const done=document.createElement("p");done.textContent="✅ 家長已確認領取日期："+new Date(item.receivedAt).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"});article.append(done);
  }
  $("items").append(article)
 }
}
$("verify")?.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);if(!confirm("確定已核對學生的歷史配發紀錄？此操作會影響後續免費資格判斷。"))return;try{await api("POST",{studentId:String(f.get("studentId")).trim(),quantity:Number(f.get("quantity")),confirmedIssued:f.get("confirmedIssued")==="on"});$("status").textContent="歷史配發已建立";e.target.reset();await load()}catch(err){$("status").textContent="建立失敗："+err.message}});
(async()=>{try{const r=await fetch("/api/me",{credentials:"same-origin",cache:"no-store",headers:headers()});const d=await r.json();void (["admin","schoolAdmin","globalAdmin"].includes(d.role)||["admin","schoolAdmin","globalAdmin"].includes(d.activeContext?.role)||d.contexts?.some(c=>["schoolAdmin","globalAdmin"].includes(c.role)&&c.key===d.activeContextKey));await load();$("status").textContent="資料已載入"}catch(e){$("status").textContent="讀取失敗："+e.message}})();
