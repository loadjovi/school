// The school roster and CSV must read the same authoritative DB master.
// Do not export the old immutable paper roster or silently fall back on it.
const safe=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=value=>String(value||"").trim().normalize("NFC");
const root=document.getElementById("competitionRosterPreview");
if(root){
 let masterRows=[],returns=[],issues=[],unmatched=[],loaded=false,lastError="";
 const sourceLabel={PUBLIC:"公費",PURCHASE:"買斷",RENTAL:"租借",PENDING:"待確認"};
 const stepLabel={PENDING:"待審核",APPROVED:"已核准",ORDERED:"已採購",ARRIVED:"已到貨",READY_FOR_PICKUP:"待領取",FULFILLED:"已完成領用",CANCELLED:"已取消"};
 const paymentLabel={AWAITING_TRANSFER:"待匯款",REPORTED_UNVERIFIED:"待核帳",VERIFIED:"已核帳",NOT_REQUIRED:"無須付款"};
 const shownClass=x=>x.originalClass||x.grade||"—";
 const date=x=>x?new Date(x).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):"";
 const getReturned=row=>{
  const stocked=returns.filter(x=>String(x.studentId)===String(row.studentId)&&x.status==="STOCKED")
   .sort((a,b)=>String(b.stockedAt||"").localeCompare(String(a.stockedAt||"")));
  if(!stocked.length)return null;
  const record=stocked[0];
  const newIssue=issues.some(issue=>String(issue.studentId)===String(row.studentId)&&String(issue.issuedAt||"")>String(record.stockedAt||""));
  return newIssue?null:record;
 };
 const statusOf=row=>{
  if(getReturned(row))return "已歸還入庫";
  if(row.requestId&&row.requestStatus!=="FULFILLED")return row.received?"歷史已領用／新申請"+(stepLabel[row.requestStatus]||"處理中"):"新申請"+(stepLabel[row.requestStatus]||"處理中");
  return row.received?"已確認領用":"領用待核對";
 };
 function render(){
  root.replaceChildren();
  if(lastError){const notice=document.createElement("p");notice.className="competition-roster-summary";notice.textContent="⚠️ "+lastError;root.append(notice);return}
  if(!loaded){const p=document.createElement("p");p.textContent="正在讀取 A 團比賽服正式主檔…";root.append(p);return}
  const summary=document.createElement("p");summary.className="competition-roster-summary";
  const undecided=masterRows.filter(x=>x.acquisition==="PENDING").length;
  summary.textContent="共 "+masterRows.length+" 位｜取得方式待選擇 "+undecided+" 位｜已確認領用 "+masterRows.filter(x=>statusOf(x)==="已確認領用").length+" 位｜領用或申請處理中 "+masterRows.filter(x=>statusOf(x)!=="已確認領用"&&statusOf(x)!=="已歸還入庫").length+" 位";
  root.append(summary);
  const hint=document.createElement("p");hint.className="competition-roster-order";
  hint.textContent="以學生學號對應正式主檔；家長有效新申請會更新取得方式、款式與尺寸。領用與歸還依實際核對紀錄顯示。";
  root.append(hint);
  if(unmatched.length){const notice=document.createElement("p");notice.className="competition-roster-summary";notice.textContent="⚠️ 有 "+unmatched.length+" 位原名單學生無法安全連結學號（"+unmatched.map(x=>x.name).join("、")+"），已停止 CSV 匯出。請先確認學生主檔。";root.append(notice)}
  const container=document.createElement("div");container.className="competition-roster-table-wrap";
  const table=document.createElement("table");table.className="competition-roster-table";
  table.innerHTML='<thead><tr><th scope="col">學生</th><th scope="col">款式／尺寸</th><th scope="col">取得方式</th><th scope="col">申請與領用</th></tr></thead>';
  const body=document.createElement("tbody");
  for(const row of masterRows){
   const tr=document.createElement("tr");
   const detail=row.requestId?"最新申請："+(stepLabel[row.requestStatus]||"待確認")+(row.paymentStatus?"｜"+(paymentLabel[row.paymentStatus]||row.paymentStatus):""):"尚無新申請（原登記）";
   const received=statusOf(row),returned=getReturned(row);
   tr.innerHTML='<td><strong>'+safe(row.studentName)+'</strong><small class="competition-class">'+safe(shownClass(row))+'</small></td>'+
    '<td><strong>'+safe(row.style)+'款 · '+safe(row.size)+'</strong></td>'+
    '<td>'+safe(sourceLabel[row.acquisition]||"待確認")+'<small>'+safe(row.source==="parent_request"?"已依家長申請更新":"原登記")+'</small></td>'+
    '<td><details class="competition-roster-detail"><summary class="roster-status'+(returned||!row.received?' is-pending':'')+'">'+safe(received)+'</summary><div>'+
    safe(detail)+'<br>樂器：'+safe(row.instrument||"—")+'<br>學號：'+safe(row.studentId)+
    (returned?'<br>歸還入庫日期：'+safe(date(returned.stockedAt)):'')+'</div></details></td>';
   body.append(tr);
  }
  table.append(body);container.append(table);root.append(container);
  const foot=document.createElement("p");foot.className="competition-roster-order";
  foot.textContent="匯出只包含正式主檔的當前資料；新申請已覆蓋原始登記的取得方式／尺寸。每次覆蓋均留下稽核紀錄。";
  root.append(foot);
 }
 async function fetchJson(path){
  const response=await fetch("/api/"+path,{credentials:"same-origin",cache:"no-store",headers:window.uniformEventAuthHeaders?.()||{}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  return data;
 }
 let loading=false;
 async function reload(){
  if(loading)return;
  loading=true;lastError="";render();
  try{
   const [master,returnData]=await Promise.all([fetchJson("uniform-events/competition-master"),fetchJson("uniform-events/competition-returns")]);
   masterRows=(master.items||[]).slice().sort((a,b)=>shownClass(a).localeCompare(shownClass(b),"en",{numeric:true})||String(a.studentName).localeCompare(String(b.studentName),"zh-Hant"));
   unmatched=master.unmatched||[];returns=returnData.items||[];issues=returnData.issues||[];
   loaded=true;lastError="";
  }catch(error){loaded=false;lastError="正式比賽服主檔讀取失敗："+error.message+"。請勿以舊名單匯出，稍後重新整理。"}
  finally{loading=false;render()}
 }
 window.addEventListener("uniformAdminAuth",event=>{if(event.detail?.authenticated)reload()});
 window.addEventListener("uniformRequestsLoaded",()=>reload());
 window.addEventListener("competitionReturnsUpdated",()=>{if(!loading)reload()});
 document.getElementById("exportCompetitionRoster")?.addEventListener("click",()=>{
  if(!loaded||lastError||unmatched.length||masterRows.length!==15){alert("主檔尚未完整同步，已停止匯出以避免不正確資料。請先重新整理並確認 15 位學生及學號。");return}
  const fields=["目前班級","學生姓名","學號","樂器","款式","尺寸","取得方式","最新申請狀態","付款狀態","實際領用／歸還狀態","歸還日期","資料來源","最新申請編號"];
  const rows=[fields,...masterRows.map(row=>{const returned=getReturned(row);return [shownClass(row),row.studentName,row.studentId,row.instrument,row.style,row.size,sourceLabel[row.acquisition]||"待確認",row.requestId?stepLabel[row.requestStatus]||row.requestStatus:"未申請",paymentLabel[row.paymentStatus]||"",statusOf(row),returned?date(returned.stockedAt):"",row.source==="parent_request"?"家長正式申請":"歷史資料遷入",row.requestId||""]})];
  const csv="\uFEFF"+rows.map(columns=>columns.map(value=>{let str=String(value??"");if(/^[=+@\-\t\r]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"'}).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="A團比賽服_正式主檔.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 render();
}
