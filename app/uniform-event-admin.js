const el=id=>document.getElementById(id);
let adminAuthenticated=false,hasFinanceAccess=false;
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
 const controller=new AbortController();
 const timeoutMs=path==="uniform-events/receiving"&&options.method==="POST"?60000:path==="uniform-events/requests"&&options.method==="PATCH"?45000:12000;
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 let r;
 try{r=await fetch("/api/"+path,{...options,signal:controller.signal,credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json",...adminAuthHeaders(),...(options.headers||{})}})}
 catch(e){if(e.name==="AbortError")throw Error("API 等待逾時（"+(timeoutMs/1000)+" 秒）；操作結果尚未確認，請查核入庫紀錄");throw e}
 finally{clearTimeout(timeout)}
 const data=await r.json().catch(()=>({}));
 if(r.status===401){setAuthGate("API 回傳 401 Unauthorized：登入憑證未通過後端驗證，所有管理操作已停用。");throw Error("401 Unauthorized：請重新登入")}
 if(r.status===403){if(/財務/.test(String(data.error||"")))throw Error(data.error);setAuthGate("API 回傳 403 Forbidden：目前帳號沒有此校管理員權限。");throw Error("403 Forbidden：權限不足")}
 if(!r.ok)throw Error(data.error||"HTTP "+r.status);
 return data;
}
let cachedRequests=[],cachedStock=[],cachedFamilyRegistrations=[],receivedRequestIds=new Set();
function showFinancePending(uniformItems=cachedRequests,familyItems=cachedFamilyRegistrations){
 if(!hasFinanceAccess)return;
 const pending=uniformItems.filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED");
 const tshirt=pending.filter(x=>x.kind==="regularUniform").length;
 const competition=pending.filter(x=>x.kind==="competitionUniform").length;
 const activities=familyItems.filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED").length;
 const total=tshirt+competition+activities,review=el("inlineFinanceReview");
 review.dataset.pending=total>0?"true":"false";
 review.querySelector("summary").textContent=total
  ?"💰 待財務核帳 "+total+" 筆｜團 T "+tshirt+"、A 團比賽服 "+competition+"、活動 "+activities+"（點此處理）"
  :"💰 財務核帳｜目前無待核帳款項";
}
async function refreshFinancePending(){
 if(!hasFinanceAccess||!adminAuthenticated||document.visibilityState!=="visible")return;
 try{
  const [uniform,family]=await Promise.all([api("uniform-events/requests"),api("uniform-events/family-registration")]);
  showFinancePending(uniform.items||[],family.items||[]);
 }catch(error){el("inlineFinanceReview").querySelector("summary").textContent="💰 財務核帳｜待辦讀取失敗，點此重新查詢"}
}
let visibleModuleRequests=[],moduleRequestsAll=[],showRequestHistory=false;
const pendingRequestIds=new Set();
const issueErrors=new Map();
let uniformStudentNames=new Map();
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let savedConfigs=[];
let activeAdminTab="regularUniform";
const adminTabDescriptions={
 settings:"建立或修改活動，設定對象團別與家長端顯示狀態。",
 accounts:"新增或修改收款帳戶，再選擇團 T 或 A 團比賽服套用。",
 regularUniform:"查看團 T 申請、學生領用、採購及庫存。固定開放家長申請。",
 competitionUniform:"查看 A 團比賽服申請、尺寸及領用紀錄。固定開放家長申請。",
 events:"查看交流／快閃活動及期末聚餐的報名與人數。",
 requests:"團服申請清單及 CSV 匯出／匯入預覽。",
 inventory:"正式庫存、尺寸盤點及數量調整。"
};
const approvedStage=row=>row.acquisition==="PUBLIC"||row.paymentStatus==="VERIFIED"?"ready":row.paymentStatus==="REPORTED_UNVERIFIED"?"reconcile":"transfer";
function renderUniformRequestAlerts(){
 const host=el("uniformRequestAlerts");
 if(!host)return;
 const tracked=new Set(["PENDING","APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"]);
 const countsFor=kind=>{
  const rows=cachedRequests.filter(x=>String(x.kind||x.type||"")===kind&&tracked.has(String(x.status||"").toUpperCase()));
  const approved=rows.filter(x=>x.status==="APPROVED");
  return {total:rows.length,pending:rows.filter(x=>x.status==="PENDING").length,transfer:approved.filter(x=>approvedStage(x)==="transfer").length,reconcile:approved.filter(x=>approvedStage(x)==="reconcile").length,ready:approved.filter(x=>approvedStage(x)==="ready").length,publicReady:approved.filter(x=>x.acquisition==="PUBLIC").length,buyoutReady:approved.filter(x=>x.acquisition!=="PUBLIC"&&approvedStage(x)==="ready").length,
   ordered:rows.filter(x=>x.status==="ORDERED").length,arrived:rows.filter(x=>x.status==="ARRIVED").length,pickup:rows.filter(x=>x.status==="READY_FOR_PICKUP").length};
 };
 const tabs=[["regularUniform","團 T",countsFor("regularUniform")],["competitionUniform","A 團比賽服",countsFor("competitionUniform")]];
 for(const [tab,label,counts] of tabs){
  const button=document.querySelector('[data-admin-tab="'+tab+'"]');
  if(button)button.textContent=label+"管理"+(counts.total?"（進行中 "+counts.total+"）":"");
 }
 host.replaceChildren();
 const total=tabs.reduce((sum,[,,counts])=>sum+counts.total,0);
 if(!total){host.hidden=true;return}
 host.hidden=false;
 const title=document.createElement("strong");title.textContent="團服申請進行中："+total+" 筆";
 host.append(title);
 for(const [tab,label,counts] of tabs){
  if(!counts.total)continue;
  const row=document.createElement("div");row.style.marginTop="8px";
  const description=document.createElement("span");
  description.textContent=label+"：待審 "+counts.pending+(tab==="competitionUniform"?"、公費已核准待採購 "+counts.publicReady+"、買斷待匯款 "+counts.transfer+"、買斷待核帳 "+counts.reconcile+"、買斷已入帳可採購 "+counts.buyoutReady:"、待匯款 "+counts.transfer+"、待財務核帳 "+counts.reconcile+"、可採購 "+counts.ready)+"、已採購待到貨 "+counts.ordered+"、已到貨待開放領取 "+counts.arrived+"、可領取 "+counts.pickup+"。";
  const btn=document.createElement("button");btn.type="button";btn.textContent="查看申請";btn.style.marginLeft="10px";
  btn.addEventListener("click",()=>{
   activeAdminTab=tab;syncUniformModuleVisibility();
   if(tab==="regularUniform")document.querySelector('[data-tshirt-view="requests"]')?.click();
   if(tab==="competitionUniform")document.querySelector('[data-competition-view="requests"]')?.click();
   el("uniformRequestsPanel")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
  row.append(description,btn);host.append(row);
 }
}
function renderModuleRequests(){
 const rows=cachedRequests.filter(x=>{
  const kind=String(x.kind||x.type||"");
  return activeAdminTab==="regularUniform"?/regular|tshirt|t-shirt/i.test(kind):/competition/i.test(kind);
 }).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
 moduleRequestsAll=rows;
 const activeRows=rows.filter(x=>["PENDING","APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(x.status));
 const displayRows=showRequestHistory?rows:activeRows;
 visibleModuleRequests=displayRows;
 const historyCount=rows.length-activeRows.length;
 el("requestsStatus").textContent="目前處理中 "+activeRows.length+" 筆"+(activeAdminTab==="competitionUniform"?" A 團比賽服":"團 T")+"申請；"+(showRequestHistory?"下方同時顯示 "+historyCount+" 筆歷史申請。":"歷史申請 "+historyCount+" 筆已收合。");
 const toggle=el("requestHistoryToggle");toggle.hidden=historyCount===0;toggle.textContent=showRequestHistory?"收合歷史申請":"顯示歷史申請（"+historyCount+" 筆）";toggle.setAttribute("aria-expanded",String(showRequestHistory));
 const counts=rows.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});
 const readyRequests=rows.filter(x=>x.status==="APPROVED"&&approvedStage(x)==="ready");
 const unreadyRequests=rows.filter(x=>x.status==="PENDING"||x.status==="APPROVED"&&approvedStage(x)!=="ready");
 const sizes=new Map();
 for(const item of readyRequests){
  const size=String(item.size||"未填尺寸");
  const quantity=Number(item.quantity);
  const count=Number.isSafeInteger(quantity)&&quantity>0?quantity:1;
  sizes.set(size,(sizes.get(size)||0)+count);
 }
 const total=[...sizes.values()].reduce((sum,n)=>sum+n,0);
 const details=[...sizes].sort((a,b)=>a[0].localeCompare(b[0],"zh-Hant")).map(([size,n])=>size+"："+n+" 件").join("、");
 const label=activeAdminTab==="regularUniform"?"團 T":"A 團比賽服";
 const units=x=>{const n=Number(x.procurementQuantity??x.quantity);return Number.isSafeInteger(n)&&n>0?n:1};
 const purchasedWaiting=rows.filter(x=>x.status==="ORDERED").reduce((n,x)=>n+units(x),0);
 const purchasedParentUnits=rows.filter(x=>x.status==="ORDERED").reduce((n,x)=>n+(Number(x.quantity)||1),0);
 const arrivedWaiting=rows.filter(x=>["ARRIVED","READY_FOR_PICKUP"].includes(x.status)).reduce((n,x)=>n+units(x),0);
 const ready=readyRequests.length;
 const publicReady=readyRequests.filter(x=>x.acquisition==="PUBLIC").length;
 const buyoutReady=ready-publicReady;
 const transfer=unreadyRequests.filter(x=>x.status==="APPROVED"&&approvedStage(x)==="transfer").length;
 const reconcile=unreadyRequests.filter(x=>x.status==="APPROVED"&&approvedStage(x)==="reconcile").length;
 const unreadyUnits=unreadyRequests.reduce((sum,x)=>sum+units(x),0);
 const dated=rows.map(x=>Date.parse(x.createdAt)).filter(Number.isFinite).sort((a,b)=>a-b);
 const dateText=timestamp=>new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(timestamp);
 const range=dated.length?(dateText(dated[0])+(dateText(dated[0])!==dateText(dated[dated.length-1])?"～"+dateText(dated[dated.length-1]):"")):"日期未記錄";
 const addMetrics=(host,items)=>{
  const metrics=document.createElement("div");metrics.className="procurement-metrics";
  for(const [name,value] of items){
   const card=document.createElement("div");card.className="procurement-metric";
   const heading=document.createElement("span");heading.textContent=name;
   const amount=document.createElement("strong");amount.textContent=value;
   card.append(heading,amount);metrics.append(card);
  }
  host.append(metrics);
 };
 const renderSummary=host=>{
  if(!host)return;
  host.replaceChildren();
  const heading=document.createElement("h3");heading.textContent="目前請購｜進行中 "+activeRows.length+" 筆";host.append(heading);
  addMetrics(host,[["待審核",(counts.PENDING||0)+" 筆"],[activeAdminTab==="competitionUniform"?"買斷待匯款":"待匯款",transfer+" 筆"],[activeAdminTab==="competitionUniform"?"買斷待核帳":"待財務核帳",reconcile+" 筆"],...(activeAdminTab==="competitionUniform"?[["公費已核准待採購",publicReady+" 筆"],["買斷已入帳可採購",buyoutReady+" 筆"]]:[["可統一採購",ready+" 筆"]]),["已採購待到貨",(counts.ORDERED||0)+" 筆／"+purchasedWaiting+" 件"],["已到貨待發放",((counts.ARRIVED||0)+(counts.READY_FOR_PICKUP||0))+" 筆／"+arrivedWaiting+" 件"]]);
  const detail=document.createElement("p");detail.className="procurement-note";
  detail.textContent="目前可採購需求："+total+" 件（"+(details||"目前沒有可採購尺寸")+"）。另有 "+unreadyUnits+" 件尚待審核／匯款／核帳，不列入可採購數量。已採購待到貨對應家長申請 "+purchasedParentUnits+" 件；超出申請的備貨到貨後入庫，不增加家長費用。";
  host.append(detail);
  const history=document.createElement("details");history.className="procurement-history";
  const historyTitle=document.createElement("summary");historyTitle.textContent="歷史申請紀錄：累計 "+rows.length+" 筆（含取消與已領取）";
  const period=document.createElement("p");period.textContent="紀錄日期範圍："+range+(dated.length<rows.length?"（部分紀錄缺少建立日期）":"")+"。這是目前資料庫查得的全部 "+label+" 申請，沒有依月份篩選。";
  const breakdown=document.createElement("p");breakdown.textContent="其中：處理中 "+activeRows.length+" 筆、已領取 "+(counts.FULFILLED||0)+" 筆、已取消 "+(counts.CANCELLED||0)+" 筆。";
  history.append(historyTitle,period,breakdown);host.append(history);
 };
 renderSummary(el("requestSummary"));
 if(activeAdminTab==="regularUniform"){
  window.renderTshirtProcurementSummary=()=>renderSummary(el("tshirtProcurementSummary"));
  window.renderTshirtProcurementSummary();
 }
 if(activeAdminTab==="competitionUniform"){
  const actionable=rows.filter(x=>["PENDING","APPROVED","ORDERED","ARRIVED","READY_FOR_PICKUP"].includes(x.status));
  el("competitionProcurementSummary").textContent="申請共 "+rows.length+" 筆；公費已核准待採購 "+publicReady+" 筆、買斷待匯款 "+transfer+" 筆、買斷待核帳 "+reconcile+" 筆、買斷已入帳可採購 "+buyoutReady+" 筆、已採購待到貨 "+(counts.ORDERED||0)+" 筆、已到貨 "+(counts.ARRIVED||0)+" 筆。尚在處理 "+actionable.length+" 筆；公費核准後可採購，買斷須財務確認入帳後才可採購。";
 }
 table("requests",displayRows.map(x=>({...x,processing:pendingRequestIds.has(x.id),received:receivedRequestIds.has(x.id),studentName:uniformStudentNames.get(String(x.studentId))||"姓名待核對",kind:/competition/i.test(String(x.kind||x.type||""))?"A 團比賽服":"團 T",acquisitionLabel:x.kind==="competitionUniform"?({PUBLIC:"公費配發",PURCHASE:"自費買斷",RENTAL:"租借",PENDING:"取得方式待核對"})[x.acquisition]||"待核對":"自費加購",statusLabel:pendingRequestIds.has(x.id)?"更新處理中…":x.status==="APPROVED"&&approvedStage(x)==="transfer"?"已核准｜待家長匯款":x.status==="APPROVED"&&approvedStage(x)==="reconcile"?"家長已回報匯款｜待財務核帳":["ARRIVED","READY_FOR_PICKUP"].includes(x.status)&&!receivedRequestIds.has(x.id)?"待補登入庫｜暫不可發放":x.status==="READY_FOR_PICKUP"&&x.acquisition!=="PUBLIC"&&x.paymentStatus!=="VERIFIED"?"待財務核帳｜暫不可領取":({PENDING:"待審核",APPROVED:x.acquisition==="PUBLIC"?"公費已核准｜待採購":x.kind==="competitionUniform"?"買斷已入帳｜可採購":"已核准｜可統一採購",ORDERED:"已採購｜待到貨",ARRIVED:"已到貨｜待安排領取",READY_FOR_PICKUP:"可以領取",FULFILLED:"已領取",CANCELLED:"已取消"})[x.status]||x.status,procurementLabel:["ORDERED","ARRIVED","READY_FOR_PICKUP","FULFILLED"].includes(x.status)?((x.procurementQuantity??x.quantity??1)+" 件"+(x.kind==="regularUniform"?"｜"+(Array.isArray(x.procurementBreakdown)?x.procurementBreakdown.map(p=>p.size+" "+p.quantity).join("、"):(x.procurementQuantity??x.quantity)>x.quantity?"尺碼未分配":x.size+" "+x.quantity):"")):"—",issueDetail:x.status==="FULFILLED"?`${x.receivedBy||"領取人待核對"}｜${x.issuedAt?new Date(x.issuedAt).toLocaleDateString("zh-TW"):"日期待核對"}`:"—"})),[["studentName","學生姓名"],["studentId","學生ID"],["kind","項目"],["acquisitionLabel","取得方式"],["size","尺寸"],["quantity","家長申請"],["procurementLabel","向廠商採購"],["statusLabel","狀態"],["issueDetail","實際領取"],["createdAt","建立時間"]],true);
}

function renderModuleStock(){
 const visibleStock=cachedStock.filter(x=>String(x.key).startsWith(activeAdminTab==="competitionUniform"?"competition:":"regular:"));
 el("stockStatus").textContent="目前顯示 "+visibleStock.length+" 筆"+(activeAdminTab==="competitionUniform"?" A 團比賽服":"團 T")+"庫存紀錄";
 if(activeAdminTab==="regularUniform"){
  const byKey=new Map(cachedStock.map(x=>[x.key,x]));
  const rows=["8","10","12","XS","S","M","L","XL","2L","3L","5L"].map(size=>{
   const item=byKey.get("regular:"+size);
   return {size,quantity:item?item.onHand+" 件":"—",state:item?"已建檔":"待盤點／未建檔"};
  });
  table("stock",rows,[["size","尺寸"],["quantity","現有數量"],["state","盤點狀態"]]);
 }else if(activeAdminTab==="competitionUniform"){
  const rows=cachedStock.filter(x=>String(x.key).startsWith("competition:")).map(x=>({size:String(x.key).slice("competition:".length).replace(":","／"),quantity:x.onHand+" 件",reserved:x.reserved,unavailable:x.unavailable}));
  table("stock",rows,[["size","款式／尺寸"],["quantity","現有"],["reserved","保留"],["unavailable","不可用"]]);
 }
}
function placeSharedUniformPanels(){
 if(!["regularUniform","competitionUniform"].includes(activeAdminTab))return;
 const requests=el("uniformRequestsPanel"),inventory=el("uniformInventoryPanel");
 const sections=[...document.querySelectorAll("section[data-admin-view]")].filter(x=>x.dataset.adminView===activeAdminTab&&x!==requests&&x!==inventory);
 const last=sections[sections.length-1];
 if(!last)return;
 requests.dataset.adminView=inventory.dataset.adminView=activeAdminTab;
 requests.dataset.uniformModulePanel=inventory.dataset.uniformModulePanel=activeAdminTab;
 requests.dataset.competitionPanel="requests";
 inventory.dataset.competitionPanel="inventory";
 el("uniformRequestsHeading").textContent=activeAdminTab==="competitionUniform"?"A 團比賽服｜家長申請":"家長團 T 申請｜需求與採購統計";
 el("uniformInventoryHeading").textContent=activeAdminTab==="competitionUniform"?"A 團比賽服｜庫存管理":"團 T｜庫存管理";
 last.insertAdjacentElement("afterend",requests);
 requests.insertAdjacentElement("afterend",inventory);
 el("inventoryType").value=activeAdminTab;
 el("inventoryType").disabled=false;
 el("inventoryType").closest("label").hidden=true;
 syncSizes();
 renderModuleStock();
 renderModuleRequests();
}
function syncUniformModuleVisibility(){
 placeSharedUniformPanels();
 const finance=el("uniformFinanceSettings"),isUniform=["regularUniform","competitionUniform"].includes(activeAdminTab);
 if(isUniform){
  const procurement=el(activeAdminTab==="regularUniform"?"tshirtProcurementPanel":"competitionProcurementPanel");
  procurement.append(finance);
  el("uniformFinanceKind").value=activeAdminTab;
  el("uniformPriceForm").elements.kind.value=activeAdminTab;
  if(typeof showUniformPrice==="function")showUniformPrice();
 }
 finance.hidden=!isUniform||!hasFinanceAccess;
 for(const panel of document.querySelectorAll("[data-admin-view]")){
  const tab=panel.dataset.adminView;
  panel.hidden=tab!==activeAdminTab;
 }
 for(const button of document.querySelectorAll("[data-admin-tab]")){
  button.setAttribute("aria-selected",String(button.dataset.adminTab===activeAdminTab));
 }
 const description=el("adminTabDescription");
 if(description){
  description.textContent=adminTabDescriptions[activeAdminTab];
 }
 if(activeAdminTab==="regularUniform"&&typeof window.syncTshirtViews==="function")window.syncTshirtViews();
 if(activeAdminTab==="competitionUniform"&&typeof window.syncCompetitionViews==="function")window.syncCompetitionViews();
}
document.querySelectorAll("[data-admin-tab]").forEach(button=>button.addEventListener("click",()=>{
 activeAdminTab=button.dataset.adminTab;
 syncUniformModuleVisibility();
}));
function renderConfigSummary(items){
 const target=el("settings");
 items=items.filter(x=>configActivityTypes.has(x.module));
 if(!items.length){target.textContent="目前尚無已儲存的活動。請在上方選擇活動類型並建立。";return}
 const fmtDate=v=>{if(!v)return "未設定";const d=new Date(v);return Number.isNaN(d.getTime())?"日期格式有誤":new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d)};
 const money=v=>"NT$ "+Number(v||0).toLocaleString("zh-TW");
 const names={yearEndDinner:"期末聚餐",fieldTrip:"交流／快閃活動",calendarActivity:"演出／競賽活動",regularUniform:"團T（T-shirt）",competitionUniform:"A團比賽服"};
 const renderCard=x=>{
  const activity=configActivityTypes.has(x.module),calendarOnly=x.module==="calendarActivity";
  const taipeiDay=value=>value?new Date(value).toLocaleDateString("sv-SE",{timeZone:"Asia/Taipei"}):"未設定";
  const dateText=calendarOnly?(x.eventDate||"未設定")+((x.endDate&&x.endDate!==x.eventDate)?" ～ "+x.endDate:""):x.module==="fieldTrip"?taipeiDay(x.startAt)+(taipeiDay(x.endAt||x.startAt)!==taipeiDay(x.startAt)?" ～ "+taipeiDay(x.endAt):""):fmtDate(x.startAt)+" ～ "+fmtDate(x.endAt||x.startAt);
  return "<article style='border:1px solid "+(x.enabled?"#8dbda2":"#d9e3dd")+";border-radius:10px;padding:14px;margin:12px 0;"+(x.enabled?"":"background:#f5f6f5;")+"'>"+
   "<strong>"+esc(x.title||names[x.module]||x.module)+"</strong>　<span style='font-weight:700;color:"+(x.enabled?"#176543":"#66736d")+"'>"+(x.enabled?"● 家長端顯示中":"○ 暫不顯示")+"</span>"+
   (activity?"<p>類別："+esc(names[x.module])+"｜地點："+esc(x.location||"未設定")+"</p>"+
   "<p>活動期間："+esc(dateText)+"｜對象："+esc(x.targetGroups||"ALL")+"</p>"+
   (calendarOnly?"<p>免報名、免收費｜"+esc(x.timeLabel||"時間另行通知")+"</p>"+(x.note?"<p>注意事項："+esc(x.note)+"</p>":""):
   "<p>報名期間："+esc(fmtDate(x.openAt))+" ～ "+esc(fmtDate(x.closeAt))+"</p>"+
   (x.closeAt&&Date.parse(x.closeAt)<Date.now()&&((x.module==="yearEndDinner"&&x.paymentOpen)||(x.module==="fieldTrip"&&x.collectionOpen))?"<p class='warn'>報名已截止，收款仍開放：僅已報名家庭可回報匯款。若要接受新報名，請延長上方「報名結束」時間並儲存。</p>":"")+
   "<p>學生："+money(x.studentFee)+"｜首位陪同者："+money(x.firstAdultFee)+"｜其他陪同者："+money(x.extraAdultFee)+"｜6 歲以下兒童（非團員）："+money(x.extraChildFee)+"</p>"):"<p>團服模組設定，非活動報名。</p>")+
   (activityTypes.has(x.module)?renderActivityRegistrationStats(x):"")+(calendarOnly?"<p style='color:#98620b'>啟用後將依團別顯示在家長行事曆；仍請在群組公告重要異動。</p>":"<p style='color:#98620b'>儲存設定不代表已向家長公告收款資訊。</p>")+
   "<button type='button' data-edit-module='"+esc(x.module)+"' data-edit-id='"+esc(x.id)+"'>"+(activity?"編輯此活動":"檢視團服設定")+"</button>"+
   (!x.enabled&&["fieldTrip","yearEndDinner"].includes(x.module)?" <button type='button' data-delete-module='"+esc(x.module)+"' data-delete-id='"+esc(x.id)+"'>刪除未使用活動</button>":"")+"</article>";
 };
 const enabled=items.filter(x=>x.enabled===true),disabled=items.filter(x=>x.enabled!==true);
 target.innerHTML="<h3>已建立活動（"+items.length+" 筆）</h3><p>已顯示與暫不顯示的活動分開列出；修改活動時請確認對象團別與日期。</p>"+
 "<section aria-label='已顯示活動'><h4 style='color:#176543'>家長端顯示中（"+enabled.length+"）</h4>"+(enabled.length?enabled.map(renderCard).join(""):"<p>目前沒有已啟用設定</p>")+"</section>"+
 "<details style='margin-top:20px;border-top:2px solid #d9e3dd;padding-top:12px'><summary style='cursor:pointer;font-weight:700'>暫不顯示（"+disabled.length+"）｜點選展開</summary>"+(disabled.length?disabled.map(renderCard).join(""):"<p>目前沒有未啟用設定</p>")+"</details>";
}
function renderActivityRegistrationStats(activity){
 const rows=cachedFamilyRegistrations.filter(r=>r.kind===activity.module&&r.activityId===activity.id&&r.registrationStatus==="REGISTERED");
 const sum=(fn)=>rows.reduce((n,r)=>n+fn(r),0);
 const students=sum(r=>r.studentIds?.length||0),adults=sum(r=>Number(r.adults||0)),children=sum(r=>Number(r.extraChildren||0));
 return "<div style='background:#f0f6f2;border-radius:8px;padding:12px;margin:12px 0'><strong>本活動家庭報名統計</strong>"+
 "<p>已報名家庭："+rows.length+" 戶｜學生："+students+" 位｜陪同大人："+adults+" 位｜非團員兒童："+children+" 位｜總人數："+(students+adults+children)+" 位</p>"+
 "<p style='font-size:0.9em'>僅統計本活動已成功報名資料，不代表已完成繳費。</p></div>";
}
function activityRegistrationRows(activity){
 return cachedFamilyRegistrations.filter(r=>r.kind===activity.module&&r.activityId===activity.id&&r.registrationStatus==="REGISTERED");
}
function activityCounts(rows){
 const count=(fn)=>rows.reduce((n,r)=>n+fn(r),0);
 const students=count(r=>Array.isArray(r.studentIds)?r.studentIds.length:0);
 const adults=count(r=>Number(r.adults||0));
 const children=count(r=>Number(r.extraChildren||0));
 return {families:rows.length,students,adults,children,total:students+adults+children};
}
function activityReportRows(){
 const activities=savedConfigs.filter(c=>activityTypes.has(c.module));
 const found=new Set(activities.map(c=>c.module+":"+c.id));
 for(const r of cachedFamilyRegistrations){
  if(!activityTypes.has(r.kind)||!r.activityId||found.has(r.kind+":"+r.activityId))continue;
  activities.push({module:r.kind,id:r.activityId,title:r.activityId});
  found.add(r.kind+":"+r.activityId);
 }
 return activities.map(activity=>({activity,rows:activityRegistrationRows(activity),counts:activityCounts(activityRegistrationRows(activity))}));
}
function paymentStatusLabel(status,activity){
 const labels={
  NOT_OPEN:(activity?.paymentOpen===true||activity?.collectionOpen===true)?"已開放匯款，待家長回報":"尚未開放匯款",
  AWAITING_TRANSFER:"待匯款",
  REPORTED_UNVERIFIED:"已回報匯款，待核帳",
  VERIFIED:"已確認入帳",
  NOT_REQUIRED:"無須付款",
  CANCELLED:"已取消"
 };
 return labels[status]||"待確認";
}
function registrationStudentNames(row){
 const ids=Array.isArray(row.studentIds)&&row.studentIds.length?row.studentIds:[row.studentId].filter(Boolean);
 return ids.length?ids.map(id=>uniformStudentNames.get(String(id))||"姓名待核對（學生 ID："+id+"）").join("、"):"學生資料待核對";
}
function refreshFamilyStatistics(){
 const reports=activityReportRows();
 const target=el("familyRows"),summary=el("familySummary");
 const names={fieldTrip:"交流／快閃活動",yearEndDinner:"期末聚餐"};
 const totals=reports.reduce((a,r)=>{for(const k of ["families","students","adults","children","total"])a[k]+=r.counts[k];return a},{families:0,students:0,adults:0,children:0,total:0});
 summary.textContent="共 "+reports.length+" 場活動；各活動分開計算。跨活動參加者可能重複，請勿將總計視為不重複人數。報名 "+totals.families+" 筆｜弦樂團學生 "+totals.students+" 位｜陪同者 "+totals.adults+" 位｜6 歲以下兒童（非團員） "+totals.children+" 位。";
 target.innerHTML=reports.length?reports.map(({activity,rows,counts},index)=>
  "<section style='border:1px solid #d9e0eb;border-radius:12px;padding:16px;margin:16px 0'>"+
  "<h3>"+esc(activity.title||activity.id)+"</h3><p>"+esc(names[activity.module]||activity.module)+"｜報名家庭 "+counts.families+" 戶｜弦樂團學生 "+counts.students+" 位｜陪同者 "+counts.adults+" 位｜6 歲以下兒童（非團員） "+counts.children+" 位｜<strong>總計 "+counts.total+" 位</strong></p>"+
  "<p><button type='button' data-export-activity-summary='"+index+"'>匯出本活動人數統計 CSV</button> <button type='button' data-export-activity-detail='"+index+"'>匯出本活動報名明細 CSV</button></p>"+
  "<div style='overflow-x:auto'><table><thead><tr><th>報名學生</th><th>弦樂團學生</th><th>陪同者</th><th>6 歲以下兒童（非團員）</th><th>小計</th><th>應繳／回報金額</th><th>匯款末五碼</th><th>匯款日期</th><th>繳費狀態</th></tr></thead><tbody>"+
  (rows.length?rows.map(r=>"<tr><td>"+esc(registrationStudentNames(r))+"</td><td>"+(Array.isArray(r.studentIds)?r.studentIds.length:0)+"</td><td>"+Number(r.adults||0)+"</td><td>"+Number(r.extraChildren||0)+"</td><td>"+((r.studentIds?.length||0)+Number(r.adults||0)+Number(r.extraChildren||0))+"</td><td>"+esc(r.transferReport?.amount??r.estimatedAmount??"待核定")+"</td><td>"+esc(r.transferReport?.lastFive||"尚未回報")+"</td><td>"+esc(r.transferReport?.transferDate||"—")+"</td><td>"+paymentStatusLabel(r.paymentStatus,activity)+"</td></tr>").join(""):"<tr><td colspan='9'>尚無已報名資料</td></tr>")+
  "</tbody></table></div></section>").join(""):"<p>目前沒有活動資料</p>";
 renderConfigSummary(savedConfigs);
 syncUniformModuleVisibility();
}
el("familyRows").addEventListener("click",event=>{
 const btn=event.target.closest("button[data-export-activity-summary],button[data-export-activity-detail]");
 if(!btn)return;
 const index=Number(btn.dataset.exportActivitySummary??btn.dataset.exportActivityDetail);
 const report=activityReportRows()[index];if(!report)return;
 const {activity,rows,counts}=report;
 const name=String(activity.title||activity.id).replace(/[\\/:*?"<>|]/g,"_").slice(0,60);
 if(btn.hasAttribute("data-export-activity-summary")){
  csv(name+"_人數統計.csv",[{activityName:activity.title||activity.id,category:activity.module,families:counts.families,students:counts.students,adults:counts.adults,children:counts.children,total:counts.total}],["activityName","category","families","students","adults","children","total"]);
 }else{
  csv(name+"_報名明細.csv",rows.map(r=>({activityName:activity.title||activity.id,studentNames:registrationStudentNames(r),parentEmail:r.parentEmail||"",studentIds:(r.studentIds||[]).join(";"),students:(r.studentIds||[]).length,adults:Number(r.adults||0),extraChildren:Number(r.extraChildren||0),total:(r.studentIds||[]).length+Number(r.adults||0)+Number(r.extraChildren||0),paymentStatus:paymentStatusLabel(r.paymentStatus,activity),transferAmount:r.transferReport?.amount??"",transferLastFive:r.transferReport?.lastFive||"",transferDate:r.transferReport?.transferDate||""})),["activityName","studentNames","parentEmail","studentIds","students","adults","extraChildren","total","paymentStatus","transferAmount","transferLastFive","transferDate"]);
 }
});
el("settings").addEventListener("click",async e=>{
 const remove=e.target.closest("button[data-delete-id]");
 if(remove){
  const item=savedConfigs.find(x=>x.module===remove.dataset.deleteModule&&x.id===remove.dataset.deleteId);if(!item)return;
  if(!confirm("刪除「"+item.title+"」？\n僅可刪除無報名紀錄的活動，連動行事曆與本活動帳戶綁定會一併移除；共用匯款帳戶會保留。"))return;
  remove.disabled=true;
  try{await api("uniform-events/config",{method:"DELETE",body:JSON.stringify({module:item.module,id:item.id})});await load();el("status").textContent="已刪除活動："+item.title}
  catch(error){alert("刪除失敗："+error.message);remove.disabled=false}
  return;
 }

 const button=e.target.closest("button[data-edit-id]");if(!button)return;
 el("configModule").value=button.dataset.editModule;syncConfig();
 if(configActivityTypes.has(button.dataset.editModule)){el("existingActivity").value=button.dataset.editId;el("existingActivity").dispatchEvent(new Event("change"))}
 else{const item=savedConfigs.find(x=>x.module===button.dataset.editModule&&x.id===button.dataset.editId);if(item)el("config").elements.enabled.value=String(item.enabled===true)}
 el("config").scrollIntoView({behavior:"smooth",block:"start"});
});
function table(id,rows,columns,actions=false){
 const header=columns.map(([key,label])=>"<th>"+esc(label)+"</th>").join("");
 const body=rows.map((r,i)=>{
  const cells=columns.map(([key,label])=>"<td data-label='"+esc(label)+"'>"+esc(r[key])+"</td>").join("");
  let controls="";
  if(actions){
   if(r.processing){controls="<td data-label='狀態管理'><span role='status'>更新處理中…</span></td>"}
   else{
   const payable=r.acquisition!=="PUBLIC";
   const mayCollect=!payable||r.paymentStatus==="VERIFIED";
   const mayOrder=!payable||r.paymentStatus==="VERIFIED";
   const next={PENDING:[["APPROVED",payable?"核准，等待付款":"核准，等待採購"],["CANCELLED","取消申請"]],APPROVED:[...(mayOrder?[["ORDERED","已統一採購"]]:[]),["CANCELLED","取消申請"]],ORDERED:[["CANCELLED","取消申請"]],ARRIVED:[...(mayCollect&&r.received?[["READY_FOR_PICKUP","開放領取"]]:[]),["CANCELLED","取消申請"]]}[r.status]||[];
   const procurementAdjust=r.kind==="團 T"&&r.status==="ORDERED"&&!r.received?"<button type='button' data-procurement='"+i+"'>更正採購尺碼與件數</button>":"";
   const amount=r.status==="APPROVED"&&r.acquisition!=="PUBLIC"&&!Number.isSafeInteger(r.amount)?"<button type='button' data-amount='"+i+"'>補正應繳金額</button>":"";
   const stockKey=r.kind==="A 團比賽服"?"competition:"+r.style+":"+r.size:"regular:"+r.size;
   const stock=cachedStock.find(x=>x.key===stockKey),needed=r.kind==="A 團比賽服"?1:Number(r.quantity);
   const existingStock=!r.received&&stock&&Number(stock.onHand)-Number(stock.reserved||0)-Number(stock.unavailable||0)>=needed;
   const issue=r.status==="READY_FOR_PICKUP"&&mayCollect&&(r.received||existingStock)?"<button type='button' data-issue='"+i+"'>"+(r.received?"確認實際發放":"以現有庫存發放")+"</button>":"";
   const needsReceipt=r.status==="ORDERED"||(r.status==="ARRIVED"||r.status==="READY_FOR_PICKUP")&&!r.received;
   const directIssue=r.kind==="A 團比賽服"&&r.status==="ORDERED"&&!r.received&&mayCollect?"<button type='button' data-direct-issue='"+i+"'>驗收到貨並直接交付</button>":"";
   const receive=needsReceipt?"<button type='button' data-receive='"+i+"'>"+(r.received?"同步已入庫狀態":r.status==="ORDERED"?r.kind==="A 團比賽服"?"到貨後入庫（暫不交付）":"驗收到貨並入庫":"補登驗收入庫")+"</button>":"";
   const progress=r.status==="ORDERED"?"<button type='button' data-cancel='"+i+"'>取消申請</button>":next.length?"<select data-index='"+i+"'><option value=''>選擇下一步</option>"+next.map(([value,label])=>"<option value='"+value+"'>"+label+"</option>").join("")+"</select><button type='button' data-update='"+i+"'>選擇後執行</button>"+(r.status==="ARRIVED"&&mayCollect&&r.received?"<p class='hint'>選擇「開放領取」後，家長畫面會顯示可以領取，並寄送通知信；實際交付時再按「確認實際發放」。</p>":""):issue||"<span>"+esc(r.statusLabel||r.status)+"</span>";
   controls="<td data-label='狀態管理'>"+directIssue+receive+(r.status==="APPROVED"&&!mayOrder?"<p class='hint'>待財務確認入帳後，才能更新為已統一採購。</p>":"")+progress+procurementAdjust+amount+(issueErrors.has(r.id)?"<p class='warn' role='alert'>"+esc(issueErrors.get(r.id))+"</p>":"")+"</td>";
   }
  }
  return "<tr>"+cells+controls+"</tr>";
 }).join("");
 el(id).innerHTML=rows.length?"<table><thead><tr>"+header+(actions?"<th>狀態管理</th>":"")+"</tr></thead><tbody>"+body+"</tbody></table>":"<p>目前沒有資料</p>";
}
function csv(name,rows,keys){
 const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
 const content="\uFEFF"+[keys.join(","),...rows.map(row=>keys.map(k=>cell(row[k])).join(","))].join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
const sizeOptions={regularUniform:["8","10","12","XS","S","M","L","XL","2L","3L","5L"],"男":["S","M","L","2L"],"女":["XS","S","M","L"]};
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
const activityTypes=new Set(["fieldTrip","yearEndDinner"]);
const configActivityTypes=new Set([...activityTypes,"calendarActivity"]);
const createActivityId=()=> "event_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);
function updateActivityConfigClarity(){
 const form=el("config"),dinner=el("configModule").value==="yearEndDinner";
 const group=form.querySelector(".dinner-only");if(group)group.hidden=!dinner;
 const payment=form.elements.paymentMode;if(payment){payment.value=dinner?"PAY_NOW":"PAY_LATER";payment.disabled=true;payment.title="依活動類型自動套用，避免選錯繳費流程";}
 const preview=el("activityFeePreview");if(!preview)return;
 const fees=["studentFee","firstAdultFee","extraAdultFee","extraChildFee"].map(k=>Number(form.elements[k]?.value));
 if(fees.some(n=>!Number.isFinite(n)||n<0)){preview.textContent="請輸入有效的非負費率。";return}
 const [student,first,extra,child]=fees;
 const amount=student+first+child;
 preview.textContent="試算範例：1 位團員＋1 位陪同者＋1 位 6 歲以下兒童（非團員）＝NT$ "+amount.toLocaleString("zh-TW")+"（團員 "+student+"＋首位陪同者 "+first+"＋6 歲以下兒童（非團員） "+child+"）。第 2 位起每位陪同者加 NT$ "+extra.toLocaleString("zh-TW")+"。";
}
el("config").addEventListener("input",e=>{if(e.target.matches('input[name$="Fee"]'))updateActivityConfigClarity();updateActivityAudiencePreview()});
el("config").addEventListener("change",updateActivityAudiencePreview);
function updateActivityAudiencePreview(){
 const form=el("config"),module=el("configModule").value,groups=form.elements[module==="calendarActivity"?"calendarTargetGroups":"targetGroups"].value;
 const groupText={ALL:"A、B、儲備團",A:"A 團",B:"B 團",C:"儲備團","A,B":"A、B 團","A,C":"A、儲備團","B,C":"B、儲備團"}[module==="yearEndDinner"?"ALL":groups]||"所選團別";
 const visible=form.elements.enabled.value==="true";
 const closeAt=form.elements.closeAt?.value,registrationClosed=closeAt&&Date.parse(closeAt)<Date.now();
 const collecting=module==="yearEndDinner"?form.elements.enabled.value==="true":module==="fieldTrip"&&form.elements.collectionOpen.value==="true";
 el("activityAudiencePreview").textContent="家長端："+(visible?groupText+"會看到此活動":"暫不顯示給家長")+"；"+(module==="calendarActivity"?"只顯示公告與行事曆，無須報名、繳費。":module==="yearEndDinner"?"家長需報名；收款需另設定帳戶。":"家長需在報名期間內報名；收款須在第二階段另外開放。")+(registrationClosed&&collecting?" 報名已截止，收款仍開放：新家庭無法報名，已報名家庭可回報匯款。若要開放新報名，請延長報名結束時間並儲存。":" 儲存後請在下方核對活動。 ");
}
for(const name of ["openAt","closeAt","paymentOpen","collectionOpen"]){
 const input=el("config").elements[name];
 if(input){input.addEventListener("change",updateActivityAudiencePreview);input.addEventListener("input",updateActivityAudiencePreview)}
}
function syncConfig(){
 const form=el("config"),module=el("configModule").value,activity=configActivityTypes.has(module),calendarOnly=module==="calendarActivity";
 form.querySelectorAll("[data-activity-field]").forEach(x=>x.hidden=!activityTypes.has(module));
 el("calendarActivityFields").hidden=!calendarOnly;
 el("activityFeePreview").hidden=calendarOnly;
 form.elements.targetGroups.closest("label").hidden=module!=="fieldTrip";
 const stagePanel=el("fieldTripCollectionPanel");if(stagePanel)stagePanel.hidden=module!=="fieldTrip";
 const fixedUniform=["regularUniform","competitionUniform"].includes(module);
 el("configEnabledWrap").hidden=fixedUniform;form.elements.enabled.disabled=fixedUniform;form.elements.enabled.value=fixedUniform?"true":form.elements.enabled.value;

 updateActivityConfigClarity();
 el("existingActivityWrap").hidden=!activity;el("activityIdHint").hidden=!activity;
 el("configModeHint").textContent=calendarOnly?"只公告，不需家長報名或繳費；儲存後會同步至對象團別的行事曆。":module==="yearEndDinner"?"期末聚餐需報名及繳費；先建立活動，再設定收款帳戶。":"交流／快閃活動需要家長報名；可先建立活動，再決定何時開放收款。";
 updateActivityAudiencePreview();
 const select=el("existingActivity"),old=select.value;
 select.innerHTML="<option value=''>建立新活動</option>"+savedConfigs.filter(x=>x.module===module).map(x=>"<option value='"+esc(x.id)+"'>"+esc(x.title||x.id)+"</option>").join("");
 if([...select.options].some(x=>x.value===old))select.value=old;
 form.elements.id.value=activity?(select.value||"default"):"default";
 if(activity&&select.value)populateActivity();
 if(["yearEndDinner","fieldTrip"].includes(module)&&!select.value){form.elements.enabled.value="false";form.elements.paymentOpen.value="false";if(module==="fieldTrip")form.elements.collectionOpen.value="false"}
 if(!activity){form.elements.enabled.value="true"}
 el("configEnabledWrap").dataset.savedEnabled=String(savedConfigs.find(x=>x.module===module&&x.id===select.value)?.enabled===true);
 updateActivityAudiencePreview();
 if(typeof window.syncDinnerBankVisibility==="function")window.syncDinnerBankVisibility();
 queueMicrotask(()=>{window.dispatchEvent(new Event("activityDatesLoaded"));syncFieldTripCollection()});
}
function localDateTimeValue(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return "";const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;}
function populateActivity(){
 const form=el("config"),item=savedConfigs.find(x=>x.module===el("configModule").value&&x.id===el("existingActivity").value);
 if(!item)return;
 form.elements.id.value=item.id;form.elements.enabled.value=String(item.enabled===true);
 if(item.module==="calendarActivity"){
  for(const [name,value] of Object.entries({eventType:item.eventType||"performance",calendarTitle:item.title||"",calendarLocation:item.location||"",calendarTargetGroups:item.targetGroups||"ALL",eventDate:item.eventDate||"",endDate:item.endDate||"",timeLabel:item.timeLabel||"",startTime:item.startTime||"",endTime:item.endTime||"",note:item.note||""}))form.elements[name].value=value;
  updateActivityAudiencePreview();return;
 }
 form.elements.targetGroups.value=item.targetGroups||"ALL";
 form.elements.paymentMode.value=item.module==="yearEndDinner"?"PAY_NOW":"PAY_LATER";
 if(form.elements.collectionOpen)form.elements.collectionOpen.value=String(item.collectionOpen===true);
 form.elements.feeStatus.value=item.feeStatus||"DRAFT";form.elements.paymentOpen.value=String(item.paymentOpen===true);
 for(const k of ["title","location","studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=item[k]??(k.endsWith("Fee")?0:"");
 for(const k of ["openAt","closeAt","startAt","endAt"])form.elements[k].value=item[k]?localDateTimeValue(item[k]):"";
 updateActivityConfigClarity();
 updateActivityAudiencePreview();
}
el("configModule").addEventListener("change",()=>{el("configSaveFeedback").textContent="尚未儲存本次設定";el("existingActivity").value="";syncConfig()});
el("existingActivity").addEventListener("change",()=>{el("configSaveFeedback").textContent="尚未儲存本次設定";syncConfig();if(el("configModule").value==="fieldTrip")refreshFieldTripBanks();if(!el("existingActivity").value){const form=el("config");for(const k of ["title","location","openAt","closeAt","startAt","endAt","calendarTitle","calendarLocation","eventDate","endDate","timeLabel","startTime","endTime","note"])form.elements[k].value="";form.elements.targetGroups.value="ALL";form.elements.calendarTargetGroups.value="ALL";for(const k of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])form.elements[k].value=0;updateActivityAudiencePreview();}});
const calendarExamples={
 competition:{eventType:"competition",calendarTitle:"A 團全國賽｜賽事期間（實際賽程待公告）",calendarTargetGroups:"A",eventDate:"2026-11-30",endDate:"2026-12-04",calendarLocation:"基隆市表演藝術中心、成功國小、深澳國小、中山高中（實際場地待公告）",timeLabel:"A 團實際比賽時間待主辦單位通知",note:"目前公告的是整體賽事期間與候選場地；A 團實際比賽日期、時間及場地，待報名完成後由主辦單位通知。"},
 christmas:{eventType:"performance",calendarTitle:"聖心弦樂團耶誕演出",calendarTargetGroups:"ALL",eventDate:"2026-12-18",endDate:"",calendarLocation:"聖心校園（A、B 團：四樓 A 團練教室；儲備團：四樓 B 團練教室）",timeLabel:"08:30 集合；演出時間以學校通知為準",note:"請帶自己的大、中、小提琴。服裝為團 T、制服黑長褲、黑皮鞋；早上穿團 T 到校，怕冷可加黑色內搭。頭髮梳理整齊，長髮請綁馬尾。08:30 準時集合，老師及志工家長會引導。此為校內慶祝活動，僅在校師生參加；活動花絮將由志工家長於群組分享。"}
};
for(const [key,id] of [["competition","calendarExampleCompetition"],["christmas","calendarExampleChristmas"]])el(id).addEventListener("click",()=>{
 if(el("existingActivity").value&&!confirm("帶入範例會覆蓋目前活動欄位，確定繼續？"))return;
 if(el("existingActivity").value){el("existingActivity").value="";el("existingActivity").dispatchEvent(new Event("change"))}
 for(const [field,value] of Object.entries(calendarExamples[key]))el("config").elements[field].value=value;
 updateActivityAudiencePreview();el("configSaveFeedback").textContent="已帶入範例，請核對日期、團別、地點與注意事項後再儲存。";
});
syncConfig();
async function load(){
 try{
  const response=await fetch("/api/students",{credentials:"same-origin",cache:"no-store",headers:typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{}});
  if(response.ok){
   const data=await response.json();
   const students=Array.isArray(data)?data:(data.items||[]);
   uniformStudentNames=new Map(students.filter(x=>x.studentId||x.id).map(x=>[String(x.studentId||x.id),String(x.name||x.studentName||"姓名待核對")]));
  }
 }catch(error){console.warn("團服申請學生姓名查詢失敗",error)}
 const sections=[
  {path:"uniform-events/family-registration",status:"familyStatus",render:data=>{cachedFamilyRegistrations=data.items||[];refreshFamilyStatistics()}},
  {path:"uniform-events/config",status:"status",render:data=>{savedConfigs=data.items||[];syncConfig();refreshFamilyStatistics()}},
  {path:"uniform-events/requests",status:"requestsStatus",render:data=>{
    cachedRequests=data.items||[];
    renderUniformRequestAlerts();
    if(["regularUniform","competitionUniform"].includes(activeAdminTab))renderModuleRequests();
  }},
  {path:"uniform-events/receiving",status:"requestsStatus",render:data=>{
    receivedRequestIds=new Set((data.items||[]).map(x=>String(x.requestId)));
    if(["regularUniform","competitionUniform"].includes(activeAdminTab))renderModuleRequests();
  }},
  {path:"uniform-events/inventory",status:"stockStatus",render:data=>{
    cachedStock=data.items||[];
    window.uniformInventoryItems=cachedStock;
    if(["regularUniform","competitionUniform"].includes(activeAdminTab))renderModuleStock();
    window.dispatchEvent(new CustomEvent("uniformInventoryLoaded",{detail:{items:cachedStock}}));
  }}
 ];
 const results=await Promise.allSettled(sections.map(async section=>{
   const data=await api(section.path);section.render(data);
   if(!["status","requestsStatus","stockStatus"].includes(section.status))el(section.status).textContent="已載入 "+(data.items?.length??0)+" 筆";
 }));
 results.forEach((result,i)=>{
   if(result.status==="rejected"){
     const section=sections[i];el(section.status).textContent="讀取失敗："+result.reason.message;
     if(section.path.includes("receiving")){receivedRequestIds=new Set();if(["regularUniform","competitionUniform"].includes(activeAdminTab))renderModuleRequests()}
     if(section.path.includes("family-registration"))el("familyRows").textContent="家庭報名讀取失敗";
     if(section.path.includes("requests"))el("requests").textContent="申請資料讀取失敗，請檢查 API";
     if(section.path.includes("inventory")){el("stock").textContent="庫存資料讀取失敗，請檢查 API";window.dispatchEvent(new CustomEvent("uniformInventoryLoadFailed",{detail:{message:result.reason.message}}))}
   }
 });
 if(hasFinanceAccess){
  if(results[0].status==="fulfilled"&&results[2].status==="fulfilled")showFinancePending();
  else el("inlineFinanceReview").querySelector("summary").textContent="💰 財務核帳｜待辦讀取失敗，請重新整理";
 }
}
async function start(){
 try{
  setAuthGate("正在驗證管理員身分…");const me=await api("me");if(me.role!=="admin"){setAuthGate("登入帳號不是此校管理員，已停用管理操作。");throw Error("僅限管理員")}setAuthGate("");
  const finance=me.capabilities?.financeVerifier===true;hasFinanceAccess=finance;
  el("status").textContent="已驗證管理員："+(me.displayName||me.email||"")+(finance?"｜具財務核帳權限":"｜未指派財務權限");
  document.querySelector('[data-admin-tab="accounts"]').hidden=!finance;
  const financeSettings=el("uniformFinanceSettings");if(financeSettings)financeSettings.hidden=!finance;
  el("inlineFinanceReview").hidden=!finance;
  await load();
  if(finance&&el("inlineFinanceReview").open)await loadInlineFinance();
 }catch(e){setAuthGate("管理員驗證未完成："+(e.message||String(e))+"。請重新檢查登入。")}
}
el("reload").onclick=()=>load().catch(e=>el("status").textContent=e.message);
function financeCard(item,type){
 const card=document.createElement("div");card.className="inline-finance-item";
 const report=item.transferReport||{},amount=Number(report.amount||item.amount||0);
 const expected=type==="uniform"?item.amount:report.expectedAmount;
 const title=document.createElement("strong");title.textContent=(type==="uniform"?(item.kind==="regularUniform"?"團 T":"A 團比賽服"):(item.kind==="yearEndDinner"?"期末聚餐":"交流／快閃活動"))+"｜"+(type==="uniform"?(uniformStudentNames.get(String(item.studentId))||item.studentId):item.parentEmail);
 const info=document.createElement("p");info.textContent="應繳 NT$ "+Number(expected||0).toLocaleString("zh-TW")+"｜回報 NT$ "+amount.toLocaleString("zh-TW")+"｜家長回報日期 "+(report.transferDate||"未提供")+"｜匯出帳號末五碼 "+(report.lastFive||"未提供");
 const form=document.createElement("form"),date=document.createElement("input"),note=document.createElement("textarea"),submit=document.createElement("button"),message=document.createElement("p");
 date.type="date";date.required=true;note.required=true;note.maxLength=300;note.rows=2;submit.type="submit";submit.textContent="確認已入帳";message.setAttribute("role","status");
 for(const [label,input] of [["銀行實際入帳日期",date],["核帳備註（記錄銀行查核依據）",note]]){const row=document.createElement("label");row.textContent=label;row.append(input);form.append(row)}
 if(!Number.isSafeInteger(expected)||expected<=0||amount!==expected){submit.disabled=true;message.textContent="回報金額與應繳金額不同，請先查明差額。"}
 form.append(submit,message);card.append(title,info,form);
 form.addEventListener("submit",async event=>{
  event.preventDefault();if(!note.value.trim()){message.textContent="請填寫核帳備註。";return}
  if(!confirm("已比對銀行實際入帳日期、金額及帳號末五碼，確認此款項已入帳？"))return;
  submit.disabled=true;message.textContent="核帳中…";
  try{
   if(type==="uniform")await api("uniform-events/uniform-transfer-report",{method:"PATCH",body:JSON.stringify({requestId:item.id,etag:item.etag,amount,bankPostedAt:date.value,note:note.value.trim()})});
   else await api("uniform-events/family-registration",{method:"PATCH",body:JSON.stringify({kind:item.kind,activityId:item.activityId,registrationId:item.id,action:"VERIFY_PAYMENT",amount,bankPostedAt:date.value,note:note.value.trim()})});
   message.textContent="已確認入帳";await load();await loadInlineFinance();
  }catch(error){message.textContent="核帳失敗："+error.message;submit.disabled=false}
 });
 return card;
}
async function loadInlineFinance(){
 if(!hasFinanceAccess||!adminAuthenticated)return;
 el("inlineFinanceStatus").textContent="正在讀取待核帳資料…";
 try{
  const [uniform,family]=await Promise.all([api("uniform-events/requests"),api("uniform-events/family-registration")]);
  const u=(uniform.items||[]).filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED"),f=(family.items||[]).filter(x=>x.paymentStatus==="REPORTED_UNVERIFIED");
  const empty=text=>{const p=document.createElement("p");p.textContent=text;return p};
  el("inlineFinanceUniform").replaceChildren(...(u.length?u.map(x=>financeCard(x,"uniform")):[empty("目前沒有待核對的團服匯款。")]));
  el("inlineFinanceFamily").replaceChildren(...(f.length?f.map(x=>financeCard(x,"family")):[empty("目前沒有待核對的活動匯款。")]));
  el("inlineFinanceStatus").textContent="待核帳：團服 "+u.length+" 筆、活動 "+f.length+" 筆。";
  showFinancePending(uniform.items||[],family.items||[]);
 }catch(error){el("inlineFinanceStatus").textContent="載入失敗："+error.message}
}
el("inlineFinanceReview").addEventListener("toggle",()=>{if(el("inlineFinanceReview").open)loadInlineFinance()});
el("inlineFinanceReload").addEventListener("click",loadInlineFinance);
setInterval(refreshFinancePending,60000);
let fieldTripBankTemplates=[],fieldTripBoundAccount=null,fieldTripBoundActivityId="",fieldTripSelectionActivityId="";
function syncFieldTripCollection(){
 const form=el("config"),activityId=el("existingActivity").value,trip=el("configModule").value==="fieldTrip",enabled=form.elements.enabled.value==="true";
 if(!trip)return;
 const select=el("fieldTripBankTemplate"),selected=fieldTripBankTemplates.find(x=>x.id===select.value),bound=fieldTripBoundActivityId===activityId&&!!fieldTripBoundAccount;
 const same=bound&&selected&&String(selected.accountNumber)===String(fieldTripBoundAccount.accountNumber)&&String(selected.bankCode)===String(fieldTripBoundAccount.bankCode);
 el("bindFieldTripBank").disabled=!activityId||!selected||!!same;
 el("fieldTripBankStatus").textContent=bound?(same||select.value==="__linked__"?"✓ 此活動已綁定收款帳戶，可設定收款狀態。":"已綁定其他帳戶；若要改用目前選取的帳戶，請按「綁定此帳戶」。"):selected?activityId?"已選擇帳戶，請按「綁定此帳戶」。":"已選擇帳戶；儲存新活動時會自動綁定。":"請選擇本活動的收款帳戶。";
 const published=!!activityId&&savedConfigs.some(x=>x.module==="fieldTrip"&&x.id===activityId&&x.enabled===true);
 const ready=published&&enabled&&bound,openOption=[...form.elements.collectionOpen.options].find(x=>x.value==="true");
 openOption.disabled=!ready;
 el("fieldTripCollectionHint").textContent=!activityId?"請先儲存活動；若已選帳戶，儲存時會自動綁定。":!published||!enabled?"請先在上方「開放給家長報名」選擇顯示並儲存。":!bound?"請先綁定並確認本活動的收款帳戶。":"已具備開放條件；選擇收款狀態，再按下方儲存按鈕。";
}
async function refreshFieldTripBanks(){
 const select=el("fieldTripBankTemplate"),message=el("fieldTripBankStatus");
 if(!select)return;
 const activityId=el("existingActivity").value,previous=fieldTripSelectionActivityId===activityId?select.value:"";
 fieldTripSelectionActivityId=activityId;fieldTripBoundAccount=null;fieldTripBoundActivityId="";
 try{
  const [templates,linked]=await Promise.all([
   api("uniform-events/payment-account-templates"),
   activityId?api("uniform-events/field-trip-payment-account?activityId="+encodeURIComponent(activityId)).catch(()=>({item:null})):Promise.resolve({item:null})
  ]);
  fieldTripBankTemplates=(templates.items||[]).filter(x=>x.active!==false&&x.isActive!==false);
  if(activityId!==el("existingActivity").value)return;
  select.replaceChildren(new Option("請選擇已儲存帳戶",""));
  for(const b of fieldTripBankTemplates)select.add(new Option((b.label||"收款帳戶")+"｜"+b.bankName+"（"+b.bankCode+"）末四碼 "+String(b.accountNumber||"").slice(-4),b.id));
  const current=linked.item;
  if(current){fieldTripBoundAccount=current;fieldTripBoundActivityId=activityId}
  if(current){
   const matched=fieldTripBankTemplates.find(b=>String(b.accountNumber)===String(current.accountNumber)&&String(b.bankCode)===String(current.bankCode));
   if(matched)select.value=matched.id;
   else{
    const option=new Option("目前已綁定｜"+current.bankName+"（"+current.bankCode+"）末四碼 "+String(current.accountNumber||"").slice(-4),"__linked__");
    select.add(option);select.value="__linked__";
   }
  }
  if(previous&&[...select.options].some(x=>x.value===previous))select.value=previous;
  syncFieldTripCollection();
 }catch(e){syncFieldTripCollection();message.textContent="讀取帳戶失敗："+e.message}
}
el("fieldTripBankTemplate").addEventListener("change",syncFieldTripCollection);
el("config").elements.collectionOpen.addEventListener("change",syncFieldTripCollection);
el("config").elements.enabled.addEventListener("change",()=>{
 if(el("configModule").value==="fieldTrip"&&el("config").elements.enabled.value!=="true")el("config").elements.collectionOpen.value="false";
 syncFieldTripCollection();updateActivityAudiencePreview();
});
el("bindFieldTripBank").addEventListener("click",async()=>{
 const message=el("fieldTripBankStatus"),activityId=el("existingActivity").value;
 const bank=fieldTripBankTemplates.find(x=>x.id===el("fieldTripBankTemplate").value);
 if(el("configModule").value!=="fieldTrip"||!activityId){message.textContent="請先儲存並選擇既有校外活動。";return}
 if(el("fieldTripBankTemplate").value==="__linked__"){message.textContent="目前帳戶已綁定，無須重複綁定。";return}
 if(!bank){message.textContent="請先選擇收款帳戶。";return}
 if(!confirm("確定將此收款帳戶綁定目前活動？若已開放收款，家長將看到新帳戶。"))return;
 try{await api("uniform-events/field-trip-payment-account",{method:"POST",body:JSON.stringify({activityId,bankName:bank.bankName,bankCode:bank.bankCode,accountHolder:bank.accountHolder,accountNumber:bank.accountNumber})});await refreshFieldTripBanks();message.textContent="已更新本活動收款帳戶，請確認顯示的帳戶正確。"}
 catch(e){message.textContent="綁定失敗："+e.message}
});
el("configModule").addEventListener("change",()=>{if(el("configModule").value==="fieldTrip")refreshFieldTripBanks()});
if(el("configModule").value==="fieldTrip")refreshFieldTripBanks();
async function bindSelectedFieldTripAccount(activityId){
 const bank=fieldTripBankTemplates.find(x=>x.id===el("fieldTripBankTemplate").value);
 if(!bank)throw Error("請先選擇有效的本活動收款帳戶。");
 await api("uniform-events/field-trip-payment-account",{method:"POST",body:JSON.stringify({activityId,bankName:bank.bankName,bankCode:bank.bankCode,accountHolder:bank.accountHolder,accountNumber:bank.accountNumber})});
 const result=await api("uniform-events/field-trip-payment-account?activityId="+encodeURIComponent(activityId));
 if(!result.item||String(result.item.accountNumber)!==String(bank.accountNumber)||String(result.item.bankCode)!==String(bank.bankCode))throw Error("收款帳戶尚未通過讀回驗證，請勿開放收款。");
 fieldTripBoundAccount=result.item;fieldTripBoundActivityId=activityId;
}
el("config").onsubmit=async e=>{
 e.preventDefault();
 const feedback=el("configSaveFeedback"),button=el("saveConfigButton");
 feedback.textContent="正在儲存活動設定…";button.disabled=true;
 let savedActivityId="",bankVerifiedOnSave=false;
 try{
  const f=new FormData(e.target),module=f.get("module"),activity=configActivityTypes.has(module);
  const id=activity?(el("existingActivity").value||createActivityId()):"default";
  const item={module,id,enabled:["regularUniform","competitionUniform"].includes(module)||f.get("enabled")==="true"};
  if(module==="calendarActivity"){
   item.title=String(f.get("calendarTitle")||"").trim();item.location=String(f.get("calendarLocation")||"").trim();
   item.eventType=String(f.get("eventType")||"performance");item.targetGroups=String(f.get("calendarTargetGroups")||"ALL");
   item.eventDate=String(f.get("eventDate")||"");item.endDate=String(f.get("endDate")||"");
   item.startTime=String(f.get("startTime")||"");item.endTime=String(f.get("endTime")||"");
   item.timeLabel=String(f.get("timeLabel")||"").trim();item.note=String(f.get("note")||"").trim();
   if(!item.title||!item.location||!item.eventDate)throw Error("請填活動名稱、地點與日期");
   if(item.endDate&&item.endDate<item.eventDate)throw Error("結束日期不可早於開始日期");
  }else if(activity){
   for(const key of ["openAt","closeAt"])if(f.get(key))item[key]=new Date(f.get(key)).toISOString();
   item.title=String(f.get("title")||"");item.location=String(f.get("location")||"");
   if(module==="fieldTrip")item.targetGroups=String(f.get("targetGroups")||"ALL");
   if(f.get("startAt"))item.startAt=new Date(module==="fieldTrip"?String(f.get("startAt")).slice(0,10)+"T12:00:00+08:00":f.get("startAt")).toISOString();
   if(f.get("endAt"))item.endAt=new Date(module==="fieldTrip"?String(f.get("endAt")).slice(0,10)+"T12:00:00+08:00":f.get("endAt")).toISOString();
   if(item.endAt&&item.startAt&&Date.parse(item.endAt)<Date.parse(item.startAt))throw Error("活動結束時間不可早於開始時間");
   item.paymentMode=module==="yearEndDinner"?"PAY_NOW":"PAY_LATER";
   if(module==="fieldTrip"){item.collectionOpen=f.get("collectionOpen")==="true";item.feeStatus=item.collectionOpen?"PUBLISHED":"DRAFT";item.paymentOpen=item.collectionOpen;}
   if(module==="yearEndDinner"){item.feeStatus=item.enabled?"PUBLISHED":"DRAFT";item.paymentOpen=item.enabled;}
   for(const key of ["studentFee","firstAdultFee","extraAdultFee","extraChildFee"])item[key]=Number(f.get(key)||0);
  }
  if(module==="yearEndDinner"&&item.enabled&&!el("existingActivity").value)throw Error("請先以「暫不顯示」儲存新活動，再選擇收款帳戶並啟用。");
  if(module==="yearEndDinner"&&item.enabled&&!window.dinnerBankSelection?.())throw Error("請先為這場期末聚餐選擇有效的收款帳戶。");
  if(module==="fieldTrip"&&item.collectionOpen&&(!el("existingActivity").value||!item.enabled||!savedConfigs.some(x=>x.module==="fieldTrip"&&x.id===id&&x.enabled===true)||fieldTripBoundActivityId!==id||!fieldTripBoundAccount))throw Error("請先儲存並開放家長報名，再確認此活動收款帳戶，才能開放第二階段收款。");
  if(!confirm("確定儲存設定？")){feedback.textContent="已取消儲存";return}
  if(module==="yearEndDinner"&&item.enabled){
   feedback.textContent="正在綁定並核對本活動收款帳戶…";
   await window.applyDinnerBankSelection(id);
   bankVerifiedOnSave=true;
  }
  await api("uniform-events/config",{method:"POST",body:JSON.stringify(item)});
  savedActivityId=id;
  if(module==="fieldTrip"&&!el("existingActivity").value&&fieldTripBankTemplates.some(x=>x.id===el("fieldTripBankTemplate").value)){
   feedback.textContent="活動已建立，正在綁定並驗證收款帳戶…";
   await bindSelectedFieldTripAccount(id);bankVerifiedOnSave=true;
  }
  if(module==="yearEndDinner"&&!item.enabled&&window.hasDinnerBankTemplateSelection?.()){
   feedback.textContent="活動已儲存，正在綁定並核對收款帳戶…";
   await window.applyDinnerBankSelection(id);
   bankVerifiedOnSave=true;
  }
  feedback.textContent="資料已送出，正在讀回驗證…";
  await load();
  if(activity){el("existingActivity").value=id;syncConfig();el("existingActivity").dispatchEvent(new Event("change"))}
  const persisted=savedConfigs.find(x=>x.module===module&&x.id===id);
  if(!persisted)throw Error("API 已回覆，但重新查詢未找到活動，請勿視為儲存成功");
  feedback.textContent=module==="yearEndDinner"&&!persisted.enabled
   ?"活動已建立並確認成功："+(persisted.title||module)+"（暫不顯示）。"+(bankVerifiedOnSave||window.dinnerBankSelection?.()?"收款帳戶已綁定，可將家長端改為「顯示」並儲存。":"請選擇下方收款帳戶並儲存，再將家長端改為「顯示」。")
   :"設定已儲存並確認成功："+(persisted.title||module)+(["fieldTrip","calendarActivity"].includes(module)?"；已依對象團別同步至行事曆／特殊活動（"+(persisted.enabled?"顯示中":"已取消")+"）。":"。")+(module==="calendarActivity"?"此公告免報名、免收費。":module==="yearEndDinner"?"收款帳戶已綁定；是否可報名依報名期間判定。":bankVerifiedOnSave?"收款帳戶已綁定；開放家長報名後，可再設定第二階段收款。":"是否可報名依活動顯示狀態與報名期間判定；收款需另行開放。");
  el("status").textContent=feedback.textContent;
 }catch(err){
  if(savedActivityId){try{await load();el("existingActivity").value=savedActivityId;syncConfig();el("existingActivity").dispatchEvent(new Event("change"))}catch(refreshError){console.warn("活動已儲存，但重新讀取失敗",refreshError)}}
  feedback.textContent=(savedActivityId?"活動資料已儲存，但收款帳戶綁定或讀回未完成：":"儲存失敗：")+err.message;
  el("status").textContent=feedback.textContent;
 }
 finally{button.disabled=false}
};
document.getElementById("retryAdminAuth").addEventListener("click",start);
start();
async function updateUniformRequest(row,body,{expectedStatus="",expectedProcurementQuantity=null,expectedProcurementBreakdown=null,successText="申請已更新"}={}){
 if(pendingRequestIds.has(row.id))return;
 pendingRequestIds.add(row.id);renderModuleRequests();
 el("status").textContent="正在儲存申請異動並通知家長…";
 try{
  const result=await api("uniform-events/requests",{method:"PATCH",body:JSON.stringify({id:row.id,etag:row.etag,...body})});
  const index=cachedRequests.findIndex(x=>x.id===row.id);
  if(index>=0)cachedRequests[index]={...cachedRequests[index],...result.item};
  pendingRequestIds.delete(row.id);renderModuleRequests();
  el("status").textContent=body.action==="SET_PROCUREMENT_QUANTITY"?successText:successText+(result.notificationStatus==="sent"?"，已寄送家長通知信":"；家長頁面已同步，通知信未確認送達");
  await load();
 }catch(error){
  try{
   const data=await api("uniform-events/requests"),updated=(data.items||[]).find(x=>x.id===row.id);
   cachedRequests=data.items||[];
   const saved=updated&&(expectedStatus?updated.status===expectedStatus:expectedProcurementQuantity!==null&&updated.procurementQuantity===expectedProcurementQuantity&&JSON.stringify(updated.procurementBreakdown)===JSON.stringify(expectedProcurementBreakdown));
   el("status").textContent=saved?successText+"；已向後端確認，通知信狀態待查": "更新未完成："+error.message;
  }catch(refreshError){el("status").textContent="無法確認異動結果："+error.message+"；請按下方「重新整理」核對。"}
  finally{pendingRequestIds.delete(row.id);renderModuleRequests()}
 }
}
let uniformBankTemplates=[];
async function loadUniformBankTemplates(){
 const form=el("uniformBankForm"),select=form.elements.templateId,message=el("uniformBankMessage");
 try{const data=await api("uniform-events/payment-account-templates");uniformBankTemplates=(data.items||[]).filter(t=>t.active===true);
  select.replaceChildren(new Option("請選擇已建立的幹部收款帳戶",""));
  for(const t of uniformBankTemplates)select.add(new Option(t.label+"｜"+t.bankName+" ****"+t.accountNumber.slice(-4),t.id));
  if(!uniformBankTemplates.length)message.textContent="目前沒有已啟用的幹部帳戶範本；請先在本頁新增。";
  await loadUniformBank();
 }catch(e){message.textContent="帳戶範本讀取失敗："+e.message}
}
async function loadUniformBank(){
 const form=el("uniformBankForm"),message=el("uniformBankMessage");
 try{const data=await api("uniform-events/uniform-payment-account?kind="+encodeURIComponent(form.elements.kind.value));
  const bank=data.item;form.elements.templateId.value=bank?.templateId||"";
  el("uniformBankPreview").textContent=bank?"目前綁定："+bank.bankName+"（"+bank.bankCode+"）｜戶名："+bank.accountHolder+"｜帳號末四碼："+bank.accountNumber.slice(-4):"目前未綁定此團服的收款帳戶。";
  message.textContent=bank?.templateId?"已沿用幹部帳戶範本。":bank?"此項使用舊版帳戶設定；請選擇幹部帳戶範本後重新綁定。":"請選擇既有帳戶並綁定，才能核准付費申請。";
 }catch(e){message.textContent="無法讀取收款帳戶："+e.message}
}
el("uniformBankKind").addEventListener("change",e=>{el("uniformBankForm").elements.kind.value=e.target.value;loadUniformBank()});
el("uniformBankForm").elements.templateId.addEventListener("change",e=>{
 const selected=uniformBankTemplates.find(t=>t.id===e.target.value);
 if(selected)el("uniformBankPreview").textContent="將綁定："+selected.bankName+"（"+selected.bankCode+"）｜戶名："+selected.accountHolder+"｜帳號末四碼："+selected.accountNumber.slice(-4);
});
el("uniformBankForm").addEventListener("submit",async e=>{
 e.preventDefault();const form=e.currentTarget,message=el("uniformBankMessage"),selected=uniformBankTemplates.find(t=>t.id===form.elements.templateId.value);
 if(!selected)return;
 if(!confirm("確認將「"+selected.label+"」綁定至此團服？核准後家長會看到此帳號。"))return;
 try{await api("uniform-events/uniform-payment-account",{method:"POST",body:JSON.stringify({kind:form.elements.kind.value,templateId:selected.id})});await loadUniformBank();message.textContent="已綁定幹部收款帳戶。"}
 catch(error){message.textContent="綁定失敗："+error.message}
});
loadUniformBankTemplates();
window.addEventListener("uniformBankTemplatesLoaded",loadUniformBankTemplates);
let uniformPrices={};
syncUniformModuleVisibility();
function showUniformPrice(){
 const form=el("uniformPriceForm"),kind=form.elements.kind.value,price=uniformPrices[kind];
 el("uniformBasePriceLabel").firstChild.textContent=kind==="competitionUniform"?"比賽服未稅原價（NT$）":"團 T 每件含稅售價（NT$）";
 el("uniformPriceDescription").textContent=kind==="competitionUniform"
  ?"A 團比賽服目前含稅售價 NT$ "+Number(price?.unitPrice??2625).toLocaleString("zh-TW")+"／套；修改未稅原價後加計 5%。新價格僅適用後續核准申請。"
  :"團 T 目前含稅售價 NT$ "+Number(price?.unitPrice??400).toLocaleString("zh-TW")+"／件；此售價已含 5% 稅額。新價格僅適用後續核准申請。";
 form.elements.basePrice.value=price?.basePrice??"";
 el("uniformPriceMessage").textContent="目前"+(kind==="competitionUniform"?"A 團比賽服":"團 T")+"售價：NT$ "+Number(price?.unitPrice??(kind==="competitionUniform"?2625:400)).toLocaleString("zh-TW")+(kind==="competitionUniform"?"／套。":"／件。");
 updateUniformPricePreview();
}
function updateUniformPricePreview(){
 const form=el("uniformPriceForm"),base=Number(form.elements.basePrice.value),kind=form.elements.kind.value;
 el("uniformPriceBreakdown").textContent=!Number.isSafeInteger(base)||base<1?"請輸入原價。":kind==="competitionUniform"
  ?"未稅原價 NT$ "+base.toLocaleString("zh-TW")+" ＋ 5% 稅額 NT$ "+(Math.round(base*1.05)-base).toLocaleString("zh-TW")+" ＝ 應繳 NT$ "+Math.round(base*1.05).toLocaleString("zh-TW")
  :"團 T 每件應繳 NT$ "+base.toLocaleString("zh-TW")+"（已含 5% 稅額，不再額外加計）。";
}
el("uniformPriceForm").elements.basePrice.addEventListener("input",updateUniformPricePreview);
async function loadUniformPrices(){
 const form=el("uniformPriceForm"),message=el("uniformPriceMessage");
 try{const data=await api("uniform-events/prices");uniformPrices=data.items||{};
  showUniformPrice();
 }catch(e){message.textContent="團服價格讀取失敗："+e.message}
}

el("uniformPriceForm").addEventListener("submit",async e=>{
 e.preventDefault();const form=e.currentTarget,message=el("uniformPriceMessage"),kind=form.elements.kind.value,basePrice=Number(form.elements.basePrice.value),reason=form.elements.reason.value.trim();
 if(!Number.isSafeInteger(basePrice)||basePrice<1||basePrice>100000||!reason){message.textContent="請填寫有效原價及調整原因";return}
 const total=Math.round(basePrice*(kind==="competitionUniform"?1.05:1));
 if(!confirm("確認將"+(kind==="regularUniform"?"團 T 每件含稅售價":"A 團比賽服未稅原價")+"調整為 NT$ "+basePrice.toLocaleString("zh-TW")+"？"+(kind==="competitionUniform"?"加 5% 後應繳 NT$ "+total.toLocaleString("zh-TW")+"。":"此金額已含 5%，不再額外加計。")+"新價格適用於後續核准申請。"))return;
 try{await api("uniform-events/prices",{method:"POST",body:JSON.stringify({kind,basePrice,reason,etag:uniformPrices[kind]?.etag??null})});form.elements.reason.value="";await loadUniformPrices();message.textContent+=" 新價格已儲存。"}
 catch(error){message.textContent="價格更新失敗："+error.message}
});
loadUniformPrices();
const tshirtSizes=["8","10","12","XS","S","M","L","XL","2L","3L","5L"];
function openProcurementForm(row,cell,trigger,correction){
 if(cell.querySelector("form"))return;
 const form=document.createElement("form");form.className="receiving-form procurement-size-form";
 const intro=document.createElement("p");intro.textContent="家長申請 "+row.size+" 號 "+row.quantity+" 件。請按廠商採購單輸入各尺碼件數；多出的尺碼將在驗收到貨後分別入庫。";form.append(intro);
 if(correction&&!row.procurementBreakdown&&(row.procurementQuantity??row.quantity)>row.quantity){
  const warning=document.createElement("p");warning.className="warn";warning.textContent="原採購共 "+row.procurementQuantity+" 件，但尚未分配尺碼。請核對廠商明細並重新登錄，入庫前不會把多出的件數算到家長尺碼。";form.append(warning);
 }
 const grid=document.createElement("div");grid.className="procurement-size-grid";
 const previous=new Map((row.procurementBreakdown||[{size:row.size,quantity:row.quantity}]).map(p=>[p.size,p.quantity]));
 const fields=new Map();
 const addWrap=document.createElement("div");addWrap.className="procurement-add-size";
 const addSelect=document.createElement("select"),addButton=document.createElement("button");addButton.type="button";addButton.textContent="＋新增尺碼";
 const refreshOptions=()=>{const selected=addSelect.value;addSelect.replaceChildren(new Option("選擇要新增的尺碼",""));for(const size of tshirtSizes)if(!fields.has(size))addSelect.add(new Option(size,size));if([...addSelect.options].some(x=>x.value===selected))addSelect.value=selected;addButton.disabled=fields.size===tshirtSizes.length};
 const addSize=(size,value)=>{
  const wrap=document.createElement("div");wrap.className="procurement-size-item";
  const label=document.createElement("label"),input=document.createElement("input");input.type="number";input.min=size===row.size?String(row.quantity):"0";input.max="100";input.step="1";input.value=String(value);input.required=true;input.inputMode="numeric";
  label.textContent=size+(size===row.size?"（家長尺碼，至少 "+row.quantity+" 件）":"");label.append(input);wrap.append(label);
  if(size!==row.size){const remove=document.createElement("button");remove.type="button";remove.textContent="移除";remove.setAttribute("aria-label","移除 "+size+" 尺碼");remove.addEventListener("click",()=>{fields.delete(size);wrap.remove();refreshOptions();updateTotal()});wrap.append(remove)}
  grid.append(wrap);fields.set(size,input);refreshOptions();updateTotal();
 };
 const total=document.createElement("p");total.className="procurement-note";
 const updateTotal=()=>{const n=[...fields.values()].reduce((sum,input)=>sum+(Number(input.value)||0),0);total.textContent="採購合計 "+n+" 件；家長申請 "+row.quantity+" 件；其餘 "+Math.max(0,n-row.quantity)+" 件為備貨。"};
 addButton.addEventListener("click",()=>{if(!addSelect.value)return;addSize(addSelect.value,0);addSelect.value=""});
 addWrap.append(addSelect,addButton);form.append(grid,addWrap,total);
 grid.addEventListener("input",updateTotal);
 addSize(row.size,previous.get(row.size)||row.quantity);
 for(const size of tshirtSizes)if(size!==row.size&&previous.get(size)>0)addSize(size,previous.get(size));
 let reason;
 if(correction){reason=document.createElement("textarea");reason.required=true;reason.maxLength=300;reason.rows=2;reason.placeholder="請填寫更正原因，例如依廠商採購單重新分配尺碼";const label=document.createElement("label");label.textContent="更正原因";label.append(reason);form.append(label)}
 const submit=document.createElement("button");submit.type="submit";submit.textContent=correction?"確認更正採購尺碼":"登錄廠商採購";
 const cancel=document.createElement("button");cancel.type="button";cancel.textContent="取消";cancel.addEventListener("click",()=>{form.remove();trigger.hidden=false});
 const message=document.createElement("p");message.setAttribute("role","status");form.append(submit,cancel,message);cell.append(form);trigger.hidden=true;
 form.addEventListener("submit",async event=>{
  event.preventDefault();const procurementBreakdown=[];
  for(const [size,input] of fields){const n=Number(input.value);if(!Number.isSafeInteger(n)||n<0||n>100){message.textContent="各尺碼請填寫 0～100 件的整數。";return}if(n)procurementBreakdown.push({size,quantity:n})}
  const procurementQuantity=procurementBreakdown.reduce((sum,p)=>sum+p.quantity,0);
  if((Number(fields.get(row.size).value)||0)<row.quantity||procurementQuantity<row.quantity||procurementQuantity>100){message.textContent="家長申請尺碼至少 "+row.quantity+" 件；採購合計最多 100 件。";return}
  if(correction&&!reason.value.trim()){message.textContent="請填寫更正原因。";return}
  const breakdown=procurementBreakdown.map(p=>p.size+" "+p.quantity+" 件").join("、");
  if(!confirm("確認廠商採購："+breakdown+"，合計 "+procurementQuantity+" 件？家長仍只申請 "+row.quantity+" 件。"))return;
  submit.disabled=true;
  try{await updateUniformRequest(row,correction?{action:"SET_PROCUREMENT_QUANTITY",procurementQuantity,procurementBreakdown,reason:reason.value.trim()}:{status:"ORDERED",procurementQuantity,procurementBreakdown},{expectedProcurementQuantity:correction?procurementQuantity:null,expectedProcurementBreakdown:procurementBreakdown,expectedStatus:correction?null:"ORDERED",successText:correction?"採購尺碼已更正；家長費用未變":"已登錄廠商採購 "+breakdown})}
  catch(error){message.textContent="更新失敗："+error.message;submit.disabled=false}
 });
}
el("requests").addEventListener("change",e=>{
 const select=e.target.closest("select[data-index]");if(!select)return;
 const button=el("requests").querySelector("button[data-update='"+select.dataset.index+"']");if(!button)return;
 button.textContent=select.value==="READY_FOR_PICKUP"?"開放領取並通知家長":select.value==="CANCELLED"?"取消申請並通知家長":select.value?"確認更新並通知家長":"選擇後執行";
});
el("requests").addEventListener("click",async e=>{
 if(e.target.dataset.directIssue!==undefined){
  const row=visibleModuleRequests[Number(e.target.dataset.directIssue)];if(!row||row.kind!=="competitionUniform"||row.status!=="ORDERED"||pendingRequestIds.has(row.id))return;
  const cell=e.target.closest("td"),button=e.target;if(cell.querySelector("form"))return;
  const form=document.createElement("form"),date=document.createElement("input"),recipient=document.createElement("input"),note=document.createElement("textarea"),save=document.createElement("button"),message=document.createElement("p");
  form.className="receiving-form";
  date.type="date";date.required=true;date.value=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  recipient.type="text";recipient.required=true;recipient.maxLength=100;recipient.value=uniformStudentNames.get(String(row.studentId))||"";
  note.required=true;note.maxLength=300;note.rows=2;note.placeholder="例：核對女款 M 號一套，已交由學生本人領取";
  for(const [label,input] of [["實際到貨日期",date],["實際領取人（學生或家長）",recipient],["驗收及交付備註",note]]){const wrap=document.createElement("label");wrap.textContent=label;wrap.append(input);form.append(wrap)}
  const hint=document.createElement("p");hint.textContent="此件到貨後直接交付，不會增加或扣減庫存；確認後會留下到貨與發放紀錄。";form.prepend(hint);
  save.type="submit";save.textContent="確認到貨並已交付";message.setAttribute("role","status");form.append(save,message);cell.append(form);button.hidden=true;
  form.addEventListener("submit",async event=>{
   event.preventDefault();
   if(!recipient.value.trim()||!note.value.trim()){message.textContent="請填寫實際領取人及交付備註。";return}
   if(!confirm("確認 A 團比賽服 "+row.style+"款 "+row.size+" 已到貨，並已實際交給 "+recipient.value.trim()+"？此操作會直接完成申請與發放紀錄，不會異動庫存。"))return;
   save.disabled=true;message.textContent="正在登記到貨與發放…";pendingRequestIds.add(row.id);
   try{await api("uniform-events/competition-direct-issue",{method:"POST",body:JSON.stringify({id:row.id,etag:row.etag,receivedDate:date.value,receivedBy:recipient.value.trim(),note:note.value.trim()})});el("status").textContent="已確認到貨並交付，沒有異動庫存";await load()}
   catch(error){message.textContent="交付結果待核對："+error.message+"。請先重新整理確認紀錄，勿直接重複提交。";await load()}
   finally{pendingRequestIds.delete(row.id)}
  });
  return;
 }
 if(e.target.dataset.receive!==undefined){
  const row=visibleModuleRequests[Number(e.target.dataset.receive)];if(!row||pendingRequestIds.has(row.id))return;
  const cell=e.target.closest("td"),button=e.target;
  if(receivedRequestIds.has(row.id)){
   if(!confirm("這筆申請已有驗收入庫紀錄。確認只同步申請的『已到貨』狀態，不會再次增加庫存？"))return;
   pendingRequestIds.add(row.id);renderModuleRequests();
   try{
    const date=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    await api("uniform-events/receiving",{method:"POST",body:JSON.stringify({id:row.id,etag:row.etag,quantity:row.kind==="regularUniform"?row.quantity:1,receivedDate:date,note:"同步既有驗收入庫紀錄"})});
    el("status").textContent="已同步到貨狀態，庫存沒有重複增加";
   }catch(error){issueErrors.set(row.id,"同步到貨狀態失敗："+error.message)}
   finally{pendingRequestIds.delete(row.id);await load();renderModuleRequests()}
   return;
  }
  if(row.kind==="regularUniform"&&!Array.isArray(row.procurementBreakdown)&&(row.procurementQuantity??row.quantity)>row.quantity){
   issueErrors.set(row.id,"原採購件數尚未分配尺碼。請先點『更正採購尺碼與件數』，依廠商採購單填寫每個尺碼，再驗收入庫。");renderModuleRequests();return;
  }
  if(cell.querySelector("form"))return;
  const form=document.createElement("form"),date=document.createElement("input"),note=document.createElement("textarea"),save=document.createElement("button"),message=document.createElement("p"),mode=document.createElement("select");
  form.className="receiving-form";date.type="date";date.required=true;date.value=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  note.required=true;note.maxLength=300;note.rows=2;note.placeholder="例：核對女款 S 號 1 套，外觀與數量無誤";
  for(const [label,input] of [["實際到貨日期",date],["驗收備註",note]]){const wrap=document.createElement("label");wrap.textContent=label;wrap.append(input);form.append(wrap)}
  const quantity=row.kind==="regularUniform"?row.quantity:1,procurementQuantity=row.kind==="regularUniform"?(row.procurementQuantity??quantity):1;
  const breakdown=row.kind==="regularUniform"?(row.procurementBreakdown||[{size:row.size,quantity}]):[{size:row.size,quantity:1}];
  const stockKey=row.kind==="competitionUniform"?"competition:"+row.style+":"+row.size:"regular:"+row.size;
  const stock=cachedStock.find(item=>item.key===stockKey);
  mode.required=true;mode.add(new Option("請選擇這件衣服如何入庫",""));mode.add(new Option("新貨到校：增加正式庫存","new"));
  if(breakdown.every(part=>{const item=cachedStock.find(x=>x.key===(row.kind==="regularUniform"?"regular:"+part.size:stockKey));return item&&Number(item.onHand)-Number(item.reserved||0)-Number(item.unavailable||0)>=part.quantity}))mode.add(new Option("先前已盤點：使用現有庫存，不重複增加","existing"));
  const modeLabel=document.createElement("label");modeLabel.textContent="庫存來源";modeLabel.append(mode);form.prepend(modeLabel);
  const detail=document.createElement("p");detail.textContent="採購合計 "+procurementQuantity+" 件；家長申請 "+row.size+" 號 "+quantity+" 件。請逐尺碼核對實際到貨；若與採購明細不同，先更正採購尺碼。";
  const checks=document.createElement("div");checks.className="procurement-size-grid";
  const receivedFields=new Map();
  for(const part of breakdown){
   const label=document.createElement("label"),input=document.createElement("input");input.type="number";input.min="0";input.max="100";input.step="1";input.required=true;input.inputMode="numeric";input.placeholder="實際件數";
   label.textContent=(row.kind==="competitionUniform"?row.style+"款 ":"")+part.size+"｜應到 "+part.quantity+" 件";label.append(input);checks.append(label);receivedFields.set(part.size,input);
  }
  save.type="submit";save.textContent="確認驗收入庫";message.setAttribute("role","status");form.prepend(detail);form.append(save,message);cell.append(form);button.hidden=true;
  form.insertBefore(checks,save);
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(!note.value.trim()){message.textContent="請填寫驗收備註。";return}
   const receivedBreakdown=breakdown.map(part=>({size:part.size,quantity:Number(receivedFields.get(part.size).value)}));
   if(receivedBreakdown.some((part,i)=>part.quantity!==breakdown[i].quantity)){message.textContent="實際到貨尺碼與採購明細不一致。請核對實物；若採購明細錯誤，先更正採購尺碼後再入庫。";return}
   if(!mode.value){message.textContent="請選擇庫存來源。";return}
   if(!confirm("確認驗收 "+receivedBreakdown.map(p=>p.size+" "+p.quantity+" 件").join("、")+"，合計 "+procurementQuantity+" 件？"+(mode.value==="existing"?"將使用現有盤點庫存，不增加庫存。":"新貨到校，將依各尺碼增加正式庫存。")))return;
   save.disabled=true;message.textContent="入庫中…";pendingRequestIds.add(row.id);
   try{await api("uniform-events/receiving",{method:"POST",body:JSON.stringify({id:row.id,etag:row.etag,quantity,procurementQuantity,receivedBreakdown,receivedDate:date.value,note:note.value.trim(),useExistingStock:mode.value==="existing"})});el("status").textContent="已依各尺碼驗收入庫並更新申請進度";await load()}
   catch(error){
    message.textContent="正在查核入庫紀錄…";
    try{
     const receipts=await api("uniform-events/receiving");
     if((receipts.items||[]).some(item=>String(item.requestId)===String(row.id))){
      message.textContent="已找到這筆入庫紀錄，正在同步申請狀態；不會重複增加庫存。";
      await load();
     }else{message.textContent="入庫結果尚未確認："+error.message+"。目前未查到入庫紀錄，請稍後重新整理再核對，勿直接重複提交。";save.disabled=false}
    }catch(checkError){message.textContent="入庫結果尚未確認："+error.message+"。查核暫時失敗，請稍後重新整理申請與庫存，再決定是否重試。";save.disabled=false}
   }
   finally{pendingRequestIds.delete(row.id)}
  });
  return;
 }
 const i=e.target.dataset.update??e.target.dataset.cancel??e.target.dataset.procurement??e.target.dataset.amount??e.target.dataset.issue;if(i===undefined)return;
 if(e.target.dataset.issue!==undefined){
  const row=visibleModuleRequests[Number(i)];if(!row||pendingRequestIds.has(row.id))return;
  const receivedBy=prompt("請填寫實際領取人（例如家長姓名）","");if(receivedBy===null)return;
  const note=prompt("請填寫發放備註（例如現場核對尺寸）","");if(note===null)return;
  if(!receivedBy.trim()||!note.trim()){el("status").textContent="領取人與發放備註皆不可空白";return}
  const useExistingStock=!receivedRequestIds.has(row.id);
  if(!confirm("確認已將 "+(row.kind==="regularUniform"?"團 T":"A 團比賽服")+" "+row.size+" 實際交給 "+receivedBy.trim()+"？"+(useExistingStock?"將使用已盤點的現有庫存，不再增加庫存，並補記此筆入庫來源。":"")+"確認後會扣除庫存並留下紀錄。"))return;
  issueErrors.delete(row.id);
  pendingRequestIds.add(row.id);renderModuleRequests();
  try{
   await api("uniform-events/fulfillment",{method:"POST",body:JSON.stringify({id:row.id,etag:row.etag,receivedBy:receivedBy.trim(),note:note.trim(),useExistingStock})});
   el("status").textContent="已確認發放並扣除庫存";await load();
  }catch(error){issueErrors.set(row.id,"發放未完成："+error.message);el("status").textContent=error.message;await load()}
  finally{pendingRequestIds.delete(row.id);renderModuleRequests()}
  return;
 }
 if(e.target.dataset.procurement!==undefined){
  const row=visibleModuleRequests[Number(i)];if(!row)return;
  openProcurementForm(row,e.target.closest("td"),e.target,true);return;
 }
 if(e.target.dataset.amount!==undefined){const row=visibleModuleRequests[Number(i)];if(!row)return;const due=(uniformPrices[row.kind]?.unitPrice||0)*(row.kind==="regularUniform"?row.quantity:1);if(!confirm("確認補正此筆應繳金額 NT$ "+due+"？"))return;await updateUniformRequest(row,{action:"SET_AMOUNT"},{successText:"應繳金額已補正"});return;}
 const row=visibleModuleRequests[Number(i)],select=el("requests").querySelector("select[data-index='"+i+"']");
 const status=e.target.dataset.cancel!==undefined?"CANCELLED":select?.value;if(!row||!status)return;
 if(status==="ORDERED"&&row.kind==="regularUniform"){
  openProcurementForm(row,e.target.closest("td"),e.target,false);return;
 }
 const confirmation=status==="READY_FOR_PICKUP"?"確認庫存已驗收入庫，並開放家長領取？送出後家長畫面會顯示「可以領取」，系統將寄送通知信。此步驟不代表已實際發放。":status==="CANCELLED"?"確定取消這筆申請並通知家長？":"確定更新這筆申請並通知家長？";
 if(!confirm(confirmation))return;
 const reason=status==="CANCELLED"?prompt("請填寫取消原因（家長可在申請紀錄查看）",""):"";
 if(status==="CANCELLED"&&(!reason||!reason.trim())){el("status").textContent="取消申請須填寫原因";return}
 await updateUniformRequest(row,{status,reason:reason?.trim()||""},{expectedStatus:status,successText:status==="READY_FOR_PICKUP"?"已開放領取；家長畫面顯示可以領取":"申請狀態已更新"});
});
el("inventoryForm").onsubmit=async e=>{
 e.preventDefault();const f=new FormData(e.target),type=String(f.get("type")),style=String(f.get("style"));
 const data={type,style,size:String(f.get("size")),action:String(f.get("action")),amount:Number(f.get("amount"))};
 if(type==="competitionUniform"&&!style){el("status").textContent="比賽服必須選男款或女款";return}
 if(!Number.isSafeInteger(data.amount)||(data.action==="SET_COUNT"?data.amount<0:data.amount===0)){el("status").textContent=data.action==="SET_COUNT"?"盤點數量須為 0 或正整數":"調整數量須為非零整數";return}
 if(!confirm("庫存操作將寫入資料庫，確認已核對實體數量？"))return;
 try{await api("uniform-events/inventory",{method:"POST",body:JSON.stringify(data)});await load();el("status").textContent="庫存已更新"}
 catch(err){el("status").textContent="庫存更新失敗："+err.message}
};
el("exportRequests").onclick=()=>csv("uniform-event-requests.csv",moduleRequestsAll.map(x=>({...x,procurementBreakdown:(x.procurementBreakdown||[]).map(p=>p.size+":"+p.quantity).join("; ")})),["id","kind","studentId","activityId","style","size","quantity","procurementQuantity","procurementBreakdown","acquisition","freeEligibility","status","createdAt","updatedAt"]);
el("requestHistoryToggle").addEventListener("click",()=>{showRequestHistory=!showRequestHistory;renderModuleRequests()});
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

