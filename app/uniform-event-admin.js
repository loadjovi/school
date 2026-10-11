const el=id=>document.getElementById(id);
async function api(path,options={}){const r=await fetch("/api/"+path,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...options});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data}
let cachedRequests=[],cachedStock=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function show(id,data){el(id).textContent=JSON.stringify(data,null,2)}
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
 for(const k of ["title","location","studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=item[k]??(k.endsWith("Fee")?0:"");
 for(const k of ["openAt","closeAt","startAt"])form.elements[k].value=item[k]?new Date(item[k]).toISOString().slice(0,16):"";
}
el("configModule").addEventListener("change",()=>{el("existingActivity").value="";syncConfig()});
el("existingActivity").addEventListener("change",()=>{syncConfig();if(!el("existingActivity").value){const form=el("config");for(const k of ["title","location","openAt","closeAt","startAt"])form.elements[k].value="";for(const k of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=0;}});
syncConfig();
async function load(){
 const sections=[
  {path:"uniform-events/family-registration",status:"familyStatus",render:data=>{
    const items=(data.items||[]).filter(x=>x.registrationStatus==="REGISTERED");
    const totals=items.reduce((a,x)=>{a.students+=x.studentIds?.length||0;a.adults+=x.adults||0;a.children+=x.extraChildren||0;return a},{students:0,adults:0,children:0});
    el("familySummary").textContent="已報名家庭 "+items.length+" 戶；團員 "+totals.students+" 位；大人 "+totals.adults+" 位；非團員兒童 "+totals.children+" 位；總人數 "+(totals.students+totals.adults+totals.children)+" 位。";
    table("familyRows",items,[["kind","活動類別"],["activityId","活動 ID"],["parentEmail","家長帳號"],["adults","大人"],["extraChildren","其他兒童"],["paymentStatus","繳費狀態"]]);
  }},
  {path:"uniform-events/config",status:"status",render:data=>{savedConfigs=data.items||[];show("settings",data);syncConfig()}},
  {path:"uniform-events/requests",status:"requestsStatus",render:data=>{
    cachedRequests=data.items||[];
    const counts=cachedRequests.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
    el("requestSummary").textContent="申請共 "+cachedRequests.length+" 筆；待處理 "+(counts.PENDING||0)+" 筆；核准 "+(counts.APPROVED||0)+" 筆";
    table("requests",cachedRequests,[["studentId","學生ID"],["kind","項目"],["size","尺寸"],["status","狀態"],["createdAt","建立時間"]],true);
  }},
  {path:"uniform-events/inventory",status:"stockStatus",render:data=>{
    cachedStock=data.items||[];
    table("stock",cachedStock,[["key","類別與尺寸"],["onHand","現有"],["reserved","保留"],["unavailable","不可用"]]);
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
     if(section.path.includes("inventory"))el("stock").textContent="庫存資料讀取失敗，請檢查 API";
   }
 });
}
async function start(){
 try{
  const me=await api("me");if(me.role!=="admin")throw Error("僅限管理員");
  el("status").textContent="已驗證管理員："+(me.displayName||me.email||"");
  await load();
 }catch(e){el("status").textContent=e.message;el("config").querySelector("button").disabled=true}
}
el("reload").onclick=()=>load().catch(e=>el("status").textContent=e.message);
el("config").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const module=f.get("module");const activity=activityTypes.has(module);const id=activity?(el("existingActivity").value||createActivityId()):"default";const item={module,id,enabled:f.get("enabled")==="true"};for(const key of ["openAt","closeAt"])if(f.get(key))item[key]=new Date(f.get(key)).toISOString();if(["fieldTrip","yearEndDinner"].includes(module)){item.title=String(f.get("title"));item.location=String(f.get("location"));if(f.get("startAt"))item.startAt=new Date(f.get("startAt")).toISOString();for(const key of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])item[key]=Number(f.get(key)||0)}if(!confirm("確定儲存設定？"))return;await api("uniform-events/config",{method:"POST",body:JSON.stringify(item)});await load();if(activity){el("existingActivity").value=id;syncConfig();el("existingActivity").dispatchEvent(new Event("change"))}el("status").textContent="活動設定已儲存："+(item.title||module)+"；請確認下方既有活動選單及收款帳戶區塊。"}catch(e){el("status").textContent="儲存失敗："+e.message}};
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
