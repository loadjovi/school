const el=id=>document.getElementById(id);
let adminAuthenticated=false;
function setAuthGate(reason=""){
 adminAuthenticated=!reason;
 const gate=document.getElementById("authGate"),area=document.getElementById("protectedAdminArea");
 gate.style.display=reason?"block":"none";
 area.inert=!!reason;
 if(reason){document.getElementById("authGateReason").textContent=reason;document.getElementById("status").textContent=reason}
 window.dispatchEvent(new CustomEvent("uniformAdminAuth",{detail:{authenticated:adminAuthenticated}}));
}
function adminAuthHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const roleContext=sessionStorage.getItem("role_context")||"";
 return {...(token&&token!=="cookie-session"?{"X-Google-ID-Token":token}:{}),...(schoolId?{"X-School-Id":schoolId}:{}),...(roleContext?{"X-Role-Context":roleContext}:{})};
}
window.uniformEventAuthHeaders=adminAuthHeaders;
async function api(path,options={}){
 const r=await fetch("/api/"+path,{...options,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...adminAuthHeaders(),...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(r.status===401){setAuthGate("API 回傳 401 Unauthorized：登入憑證未通過後端驗證，所有管理操作已停用。");throw Error("401 Unauthorized：請重新登入")}
 if(r.status===403){setAuthGate("API 回傳 403 Forbidden：目前帳號沒有此校管理員權限。");throw Error("403 Forbidden：權限不足")}
 if(!r.ok)throw Error(data.error||"HTTP "+r.status);
 return data;
}
let cachedRequests=[],cachedStock=[],cachedFamilyRegistrations=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function renderConfigSummary(items){
 const target=el("settings");
 if(!items.length){target.textContent="目前尚無已儲存的活動或團服設定。";return}
 const fmtDate=v=>{if(!v)return "未設定";const d=new Date(v);return Number.isNaN(d.getTime())?"日期格式有誤":new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d)};
 const money=v=>"NT$ "+Number(v||0).toLocaleString("zh-TW");
 const names={yearEndDinner:"期末聚餐",fieldTrip:"校外所有活動",regularUniform:"團T（T-shirt）",competitionUniform:"A團比賽服"};
 const renderCard=x=>{
  const activity=activityTypes.has(x.module);
  return "<article style='border:1px solid "+(x.enabled?"#8dbda2":"#d9e3dd")+";border-radius:10px;padding:14px;margin:12px 0;"+(x.enabled?"":"background:#f5f6f5;")+"'>"+
   "<strong>"+esc(x.title||names[x.module]||x.module)+"</strong>　<span style='font-weight:700;color:"+(x.enabled?"#176543":"#66736d")+"'>"+(x.enabled?"● 已啟用":"○ 未啟用｜家長不可報名")+"</span>"+
   (activity?"<p>類別："+esc(names[x.module])+"｜地點："+esc(x.location||"未設定")+"</p>"+
   "<p>活動期間："+esc(fmtDate(x.startAt))+" ～ "+esc(fmtDate(x.endAt||x.startAt))+"</p>"+
   "<p>報名期間："+esc(fmtDate(x.openAt))+" ～ "+esc(fmtDate(x.closeAt))+"</p>"+
   "<p>學生："+money(x.studentFee)+"｜首位大人："+money(x.firstAdultFee)+"｜額外大人："+money(x.extraAdultFee)+"｜額外兒童："+money(x.extraChildFee)+"</p>":"<p>團服模組設定，非活動報名。</p>")+
   (activity?renderActivityRegistrationStats(x):"")+"<p style='color:#98620b'>儲存設定不代表已向家長公告收款資訊。</p>"+
   "<button type='button' data-edit-module='"+esc(x.module)+"' data-edit-id='"+esc(x.id)+"'>編輯此設定</button></article>";
 };
 const enabled=items.filter(x=>x.enabled===true),disabled=items.filter(x=>x.enabled!==true);
 target.innerHTML="<h3>活動與團服設定（"+items.length+" 筆）</h3><p>已啟用與未啟用分區顯示；已啟用設定仍須確認報名期間及收款公告。</p>"+
 "<section aria-label='已啟用設定'><h4 style='color:#176543'>已啟用（"+enabled.length+"）</h4>"+(enabled.length?enabled.map(renderCard).join(""):"<p>目前沒有已啟用設定</p>")+"</section>"+
 "<details style='margin-top:20px;border-top:2px solid #d9e3dd;padding-top:12px'><summary style='cursor:pointer;font-weight:700'>未啟用（"+disabled.length+"）｜點選展開</summary>"+(disabled.length?disabled.map(renderCard).join(""):"<p>目前沒有未啟用設定</p>")+"</details>";
}
function renderActivityRegistrationStats(activity){
 const rows=cachedFamilyRegistrations.filter(r=>r.kind===activity.module&&r.activityId===activity.id&&r.registrationStatus==="REGISTERED");
 const sum=(fn)=>rows.reduce((n,r)=>n+fn(r),0);
 const students=sum(r=>r.studentIds?.length||0),adults=sum(r=>Number(r.adults||0)),children=sum(r=>Number(r.extraChildren||0));
 return "<div style='background:#f0f6f2;border-radius:8px;padding:12px;margin:12px 0'><strong>本活動家庭報名統計</strong>"+
 "<p>已報名家庭："+rows.length+" 戶｜學生："+students+" 位｜陪同大人："+adults+" 位｜非團員兒童："+children+" 位｜總人數："+(students+adults+children)+" 位</p>"+
 "<p style='font-size:0.9em'>僅統計本活動已成功報名資料，不代表已完成繳費。</p></div>";
}
function refreshFamilyStatistics(){
 const rows=cachedFamilyRegistrations.filter(r=>r.registrationStatus==="REGISTERED");
 const students=rows.reduce((n,r)=>n+(r.studentIds?.length||0),0),adults=rows.reduce((n,r)=>n+Number(r.adults||0),0),children=rows.reduce((n,r)=>n+Number(r.extraChildren||0),0);
 el("familySummary").textContent="所有活動合計（"+rows.length+" 筆報名，跨活動可能重複計入家庭）：學生 "+students+" 位｜大人 "+adults+" 位｜非團員兒童 "+children+" 位。請以上方各活動卡片的獨立統計為準。";
 const names={fieldTrip:"校外所有活動",yearEndDinner:"期末聚餐"};
 table("familyRows",rows.map(r=>({...r,activityName:savedConfigs.find(c=>c.module===r.kind&&c.id===r.activityId)?.title||r.activityId,category:names[r.kind]||r.kind})),[["category","活動類別"],["activityName","活動名稱"],["parentEmail","家長帳號"],["adults","大人"],["extraChildren","其他兒童"],["paymentStatus","繳費狀態"]]);
 renderConfigSummary(savedConfigs);
}
el("settings").addEventListener("click",e=>{
 const button=e.target.closest("button[data-edit-id]");if(!button)return;
 el("configModule").value=button.dataset.editModule;syncConfig();
 if(activityTypes.has(button.dataset.editModule)){el("existingActivity").value=button.dataset.editId;populateActivity()}
 else{const item=savedConfigs.find(x=>x.module===button.dataset.editModule&&x.id===button.dataset.editId);if(item)el("config").elements.enabled.value=String(item.enabled===true)}
 el("config").scrollIntoView({behavior:"smooth",block:"start"});
});
function table(id,rows,columns,actions=false){
 const header=columns.map(([key,label])=>"<th>"+esc(label)+"</th>").join("");
 const body=rows.map((r,i)=>"<tr>"+columns.map(([key])=>"<td>"+esc(r[key])+"</td>").join("")+(actions?"<td><select data-index='"+i+"'><option value=''>選擇操作</option><option value='APPROVED'>核准</option><option value='CANCELLED'>取消</option><option value='PENDING'>待處理</option></select><button type='button' data-update='"+i+"'>更新</button></td>":"")+"</tr>").join("");
 el(id).innerHTML=rows.length?"<table><thead><tr>"+header+(actions?"<th>狀態管理</th>":"")+"</tr></thead><tbody>"+body+"</tbody></table>":"<p>目前沒有資料</p>";
}
function csv(name,rows,keys){
 const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
 const content="\uFEFF"+[keys.join(","),...rows.map(row=>keys.map(k=>cell(row[k])).join(","))].join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
const sizeOptions={regularUniform:["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"],"男":["S","M","L","2L"],"女":["XS","S","M","L"]};
function syncSizes(){
 const type=el("inventoryType").value,style=el("inventoryStyle"),size=el("inventorySize");
 style.disabled=type==="regularUniform";
 if(type==="regularUniform")style.value="";
 else if(!["男","女"].includes(style.value))style.value="男";
 const options=type==="regularUniform"?sizeOptions.regularUniform:sizeOptions[style.value];
 const previous=size.value;size.innerHTML=options.map(v=>"<option value='"+v+"'>"+v+"</option>").join("");
 if(options.includes(previous))size.value=previous;
}
el("inventoryType").addEventListener("change",syncSizes);
el("inventoryStyle").addEventListener("change",syncSizes);
syncSizes();
let savedConfigs=[];
const activityTypes=new Set(["fieldTrip","yearEndDinner"]);
const createActivityId=()=> "event_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
function syncConfig(){
 const form=el("config"),module=el("configModule").value,activity=activityTypes.has(module);
 form.querySelectorAll("[data-activity-field]").forEach(x=>x.hidden=!activity);
 el("existingActivityWrap").hidden=!activity;el("activityIdHint").hidden=!activity;
 const select=el("existingActivity"),old=select.value;
 select.innerHTML="<option value=''>建立新活動</option>"+savedConfigs.filter(x=>x.module===module).map(x=>"<option value='"+esc(x.id)+"'>"+esc(x.title||x.id)+"</option>").join("");
 if([...select.options].some(x=>x.value===old))select.value=old;
 form.elements.id.value=activity?(select.value||"default"):"default";
 if(activity&&select.value)populateActivity();
}
function populateActivity(){
 const form=el("config"),item=savedConfigs.find(x=>x.module===el("configModule").value&&x.id===el("existingActivity").value);
 if(!item)return;
 form.elements.id.value=item.id;form.elements.enabled.value=String(item.enabled===true);
 form.elements.paymentMode.value=item.paymentMode||(item.module==="yearEndDinner"?"PAY_NOW":"FLEXIBLE");
 for(const k of ["title","location","studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=item[k]??(k.endsWith("Fee")?0:"");
 for(const k of ["openAt","closeAt","startAt","endAt"])form.elements[k].value=item[k]?new Date(item[k]).toISOString().slice(0,16):"";
}
el("configModule").addEventListener("change",()=>{el("existingActivity").value="";syncConfig()});
el("existingActivity").addEventListener("change",()=>{syncConfig();if(!el("existingActivity").value){const form=el("config");for(const k of ["title","location","openAt","closeAt","startAt","endAt"])form.elements[k].value="";for(const k of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=0;}});
syncConfig();
async function load(){
 const sections=[
  {path:"uniform-events/family-registration",status:"familyStatus",render:data=>{cachedFamilyRegistrations=data.items||[];refreshFamilyStatistics()}},
  {path:"uniform-events/config",status:"status",render:data=>{savedConfigs=data.items||[];syncConfig();refreshFamilyStatistics()}},
  {path:"uniform-events/requests",status:"requestsStatus",render:data=>{
    cachedRequests=data.items||[];
    const counts=cachedRequests.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
    el("requestSummary").textContent="申請共 "+cachedRequests.length+" 筆；待處理 "+(counts.PENDING||0)+" 筆；核准 "+(counts.APPROVED||0)+" 筆";
    table("requests",cachedRequests,[["studentId","學生ID"],["kind","項目"],["size","尺寸"],["status","狀態"],["createdAt","建立時間"]],true);
  }},
  {path:"uniform-events/inventory",status:"stockStatus",render:data=>{
    cachedStock=data.items||[];
    table("stock",cachedStock,[["key","類別與尺寸"],["onHand","現有"],["reserved","保留"],["unavailable","不可用"]]);
    window.dispatchEvent(new CustomEvent("uniformInventoryLoaded",{detail:{items:cachedStock}}));
  }}
 ];
 const results=await Promise.allSettled(sections.map(async section=>{
   const data=await api(section.path);section.render(data);
   if(section.status!=="status")el(section.status).textContent="已載入 "+(data.items?.length??0)+" 筆";
 }));
 results.forEach((result,i)=>{
   if(result.status==="rejected"){
     const section=sections[i];el(section.status).textContent="讀取失敗："+result.reason.message;
     if(section.path.includes("family-registration"))el("familyRows").textContent="家庭報名讀取失敗";
     if(section.path.includes("requests"))el("requests").textContent="申請資料讀取失敗，請檢查 API";
     if(section.path.includes("inventory")){el("stock").textContent="庫存資料讀取失敗，請檢查 API";window.dispatchEvent(new CustomEvent("uniformInventoryLoadFailed",{detail:{message:result.reason.message}}))}
   }
 });
}
async function start(){
 try{
  setAuthGate("正在驗證管理員身分…");const me=await api("me");if(me.role!=="admin"){setAuthGate("登入帳號不是此校管理員，已停用管理操作。");throw Error("僅限管理員")}setAuthGate("");
  el("status").textContent="已驗證管理員："+(me.displayName||me.email||"");
  await load();
  await loadUniformAudit();
 }catch(e){if(!adminAuthenticated)setAuthGate(e.message);else el("status").textContent=e.message}
}
el("reload").onclick=()=>load().catch(e=>el("status").textContent=e.message);
el("config").onsubmit=async e=>{
 e.preventDefault();
 const feedback=el("configSaveFeedback"),button=el("saveConfigButton");
 feedback.textContent="正在儲存活動設定…";button.disabled=true;
 try{
  const f=new FormData(e.target),module=f.get("module"),activity=activityTypes.has(module);
  const id=activity?(el("existingActivity").value||createActivityId()):"default";
  const item={module,id,enabled:f.get("enabled")==="true"};
  for(const key of ["openAt","closeAt"])if(f.get(key))item[key]=new Date(f.get(key)).toISOString();
  if(activity){
   item.title=String(f.get("title")||"");item.location=String(f.get("location")||"");
   if(f.get("startAt"))item.startAt=new Date(f.get("startAt")).toISOString();
   if(f.get("endAt"))item.endAt=new Date(f.get("endAt")).toISOString();
   if(item.endAt&&item.startAt&&Date.parse(item.endAt)<Date.parse(item.startAt))throw Error("活動結束時間不可早於開始時間");
   item.paymentMode=module==="yearEndDinner"?"PAY_NOW":String(f.get("paymentMode")||"FLEXIBLE");
   for(const key of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])item[key]=Number(f.get(key)||0);
  }
  if(!confirm("確定儲存設定？")){feedback.textContent="已取消儲存";return}
  await api("uniform-events/config",{method:"POST",body:JSON.stringify(item)});
  feedback.textContent="資料已送出，正在讀回驗證…";
  await load();
  if(activity){el("existingActivity").value=id;syncConfig();el("existingActivity").dispatchEvent(new Event("change"))}
  const persisted=savedConfigs.find(x=>x.module===module&&x.id===id);
  if(!persisted)throw Error("API 已回覆，但重新查詢未找到活動，請勿視為儲存成功");
  feedback.textContent="設定已儲存並確認成功："+(persisted.title||module)+"。此設定僅供後台管理使用，是否開放家長報名依活動啟用狀態與報名期間判定。";
  el("status").textContent=feedback.textContent;
 }catch(err){feedback.textContent="儲存失敗："+err.message;el("status").textContent=feedback.textContent}
 finally{button.disabled=false}
};
document.getElementById("retryAdminAuth").addEventListener("click",start);
start();
el("requests").addEventListener("click",async e=>{
 const i=e.target.dataset.update;if(i===undefined)return;
 const row=cachedRequests[Number(i)],select=el("requests").querySelector("select[data-index='"+i+"']");
 const status=select?.value;if(!row||!status)return;
 if(!confirm("確定將這筆申請改為 "+status+"？"))return;
 try{await api("uniform-events/requests",{method:"PATCH",body:JSON.stringify({id:row.id,etag:row.etag,status})});await load();el("status").textContent="申請狀態已更新"}
 catch(err){el("status").textContent="更新失敗："+err.message}
});
el("inventoryForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.target),type=String(f.get("type")),style=String(f.get("style"));
 const data={type,style,size:String(f.get("size")),action:String(f.get("action")),amount:Number(f.get("amount"))};
 if(type==="competitionUniform"&&!style){el("status").textContent="比賽服必須選男款或女款";return}
 if(!Number.isSafeInteger(data.amount)||data.amount===0){el("status").textContent="數量須為非零整數";return}
 if(!confirm("庫存操作將寫入資料庫，確認已核對實體數量？"))return;
 try{await api("uniform-events/inventory",{method:"POST",body:JSON.stringify(data)});await load();el("status").textContent="庫存已更新"}
 catch(err){el("status").textContent="庫存更新失敗："+err.message}
};
el("exportRequests").onclick=()=>csv("uniform-event-requests.csv",cachedRequests,["id","kind","studentId","activityId","style","size","quantity","acquisition","freeEligibility","status","createdAt","updatedAt"]);
el("exportStock").onclick=()=>csv("uniform-inventory.csv",cachedStock,["key","onHand","reserved","unavailable"]);

function parseCsv(text){
 text=text.replace(/^\uFEFF/,"");
 const rows=[],row=[];let value="",quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}
  else if(c==='"')quoted=true;
  else if(c===","){row.push(value);value=""}
  else if(c==="\n"){row.push(value.replace(/\r$/,""));rows.push([...row]);row.length=0;value=""}
  else value+=c;
 }
 if(quoted)throw Error("CSV 引號未結束");
 if(value||row.length){row.push(value.replace(/\r$/,""));rows.push([...row])}
 return rows;
}
function setupImport(inputId,previewId,required){
 el(inputId).addEventListener("change",async e=>{
  const out=el(previewId),file=e.target.files?.[0];if(!file)return;
  try{
   if(file.size>1024*1024)throw Error("檔案超過 1MB");
   const rows=parseCsv(await file.text());if(!rows.length)throw Error("CSV 是空檔");
   const headers=rows[0].map(x=>x.trim());
   const missing=required.filter(k=>!headers.includes(k));
   if(missing.length)throw Error("缺少欄位："+missing.join("、"));
   if(rows.some(r=>r.length!==headers.length))throw Error("CSV 有列的欄位數量不一致");
   const data=rows.slice(1).filter(r=>r.some(v=>v.trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
   out.innerHTML="<p>CSV 檢查通過，共 "+data.length+" 筆；僅供預覽，尚未寫入資料庫。</p>";
   const keys=headers.slice(0,8);
   const preview=data.slice(0,10);
   const t=document.createElement("table");
   t.innerHTML="<thead><tr>"+keys.map(k=>"<th>"+esc(k)+"</th>").join("")+"</tr></thead><tbody>"+preview.map(r=>"<tr>"+keys.map(k=>"<td>"+esc(r[k])+"</td>").join("")+"</tr>").join("")+"</tbody>";
   out.appendChild(t);
  }catch(err){out.textContent="CSV 檢查失敗："+err.message}
 });
}
setupImport("importRequests","previewRequests",["kind","studentId"]);
setupImport("importStock","previewStock",["key","onHand"]);

async function loadUniformAudit(){
 const status=el("auditStatus"),target=el("uniformAuditRows");
 if(!status||!target)return;
 status.textContent="讀取操作紀錄中…";
 try{
  const data=await api("uniform-events/audit");
  const items=data.items||[];
  target.replaceChildren();
  const tableEl=document.createElement("table"),head=document.createElement("thead"),body=document.createElement("tbody");
  head.innerHTML="<tr><th>操作時間</th><th>操作人員</th><th>異動類型</th><th>異動對象</th><th>異動內容</th></tr>";
  for(const item of items){
   const tr=document.createElement("tr");
   const fields=[item.at?new Date(item.at).toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false}):"—",item.actor,item.action,item.subjectId,item.details];
   for(const value of fields){const td=document.createElement("td");td.textContent=String(value??"");td.style.overflowWrap="anywhere";tr.append(td)}
   body.append(tr);
  }
  tableEl.append(head,body);target.append(tableEl);
  status.textContent="已載入最近 "+items.length+" 筆操作紀錄（最多 200 筆）";
 }catch(e){status.textContent="讀取失敗："+e.message}
}
el("reloadAudit")?.addEventListener("click",loadUniformAudit);
