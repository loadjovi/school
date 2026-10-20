import {isCurrentTshirtStudent,tshirtRosterMembers,tshirtArchiveLabel} from "./tshirt-roster-status.mjs";
// 團 T 資格核對：依學生主檔狀態分開匯出在團及退出歷史；不會寫回領用或學生主檔。
const $=id=>document.getElementById(id);
const headers=["studentId","studentName","group","firstFreeEligible","firstIssued","issuedAt","size","notes"];
const exportHeaders=[...headers,"schoolHandoffStatus","schoolIssuedAt","handoffTo","parentReceivedAt"];
const rosterExportHeaders=[...exportHeaders,"studentStatus","inactiveReason"];
const statuses=new Set(["YES","NO","UNKNOWN"]);
function download(rows,mode){
 const csv="\uFEFF"+[rosterExportHeaders,...rows].map(row=>row.map(v=>{let value=String(v??"");if(/^[=+@\-\t\r]/.test(value))value="\u0027"+value;return "\""+value.replace(/"/g,'""')+"\""}).join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download=mode==="archive"?"團T_退團畢業_歷史核對.csv":"團T_在團學生_首次資格核對.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportEligibility(mode="current"){
 try{
  const headers=typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{};
  const r=await fetch("/api/students",{credentials:"same-origin",cache:"no-store",headers});
  if(r.status===401)throw Error("登入驗證失敗（HTTP 401）。請重新登入。");
  if(r.status===403)throw Error("權限不足（HTTP 403）。請切換為此校管理員。");
  if(!r.ok)throw Error("無法取得學生主檔（HTTP "+r.status+"）");
  const payload=await r.json();
  const students=Array.isArray(payload)?payload:(payload.items||[]);
  const historyResponse=await fetch("/api/uniform-events/tshirt-historical-size",{credentials:"same-origin",cache:"no-store",headers});
  if(!historyResponse.ok)throw Error("無法讀取最新團 T 領取紀錄，已停止匯出，請稍後重試（HTTP "+historyResponse.status+"）");
  const historyData=await historyResponse.json().catch(()=>({}));
  if(!Array.isArray(historyData.items))throw Error("團 T 領用紀錄格式不正確，已停止匯出");
  const historical=new Map(historyData.items.map(item=>[String(item.studentId||""),item]));
  const map=new Map(),unclassified=[];
  const roster=tshirtRosterMembers(students,"ALL",mode);
  for(const student of roster){
   const id=String(student.studentId||"").trim(),name=String(student.name||student.studentName||"").trim();
   const raw=String(student.groupName||student.group||"").trim().toUpperCase();
   const group=/^(A|A團|A 團)$/.test(raw)?"A":/^(B|B團|B 團)$/.test(raw)?"B":/^(C|C團|C 團|儲備團|儲備)$/.test(raw)?"儲備團":"";
   if(!id)continue;
   if(!group){unclassified.push(name||id);continue}
   const exception=name==="李沛臻";
   const item=historical.get(id);
   const issued=item?item.historicalIssued===true:(group==="A"||group==="B")&&!exception;
   const eligible=isCurrentTshirtStudent(student)&&!issued&&!item?.schoolIssuedAt; // a handed-over item is reserved, not available for another free issue
   const receivedDate=item?.receivedAt||item?.verifiedAt||"";
   const status=item?.source==="PARENT_CONFIRMED_FIRST_PUBLIC"?"雙方確認完成"
     :item?.schoolIssuedAt?"學校已發放，待家長確認"
     :issued?"歷史已領取"
     :item?.size?"待學校發放":"待家長登記尺寸";
   const noteBase=issued?"已領取，首次公費資格已使用":item?.schoolIssuedAt?"學校已交付 1 件，等待家長確認；避免重複免費領取":item?.size?"尺寸已登記，尚待學校發放":"尚未首次領取，保留首次公費資格";
   const note=isCurrentTshirtStudent(student)?noteBase:tshirtArchiveLabel(student)+"，歷史資料不列入目前發放／尺寸需求；"+noteBase;
   map.set(id,[id,name,group,eligible?"YES":"NO",issued?"YES":"NO",issued?(receivedDate||"UNKNOWN"):"",item?.size||"",note,status,item?.schoolIssuedAt||"",item?.schoolHandoffTo||"",item?.receivedAt||"",isCurrentTshirtStudent(student)?"active":"inactive",student.inactiveReason||""]);
  }
  if(!map.size){$("tshirtEligibilityPreview").textContent=mode==="archive"?"目前沒有已退出／停用學生的團 T 歷史資料。":"目前沒有可匯出的在團學生，請核對主檔狀態與團別。";return}
  download([...map.values()],mode);
  $("tshirtEligibilityPreview").textContent="已匯出 "+map.size+" 位"+(mode==="archive"?"退團／畢業歷史":"目前在團")+"學生；匯出包含學生狀態、尺寸、交付與家長領用確認時間。歷史檔只供查核，不列入目前發放／採購統計。"+(unclassified.length?"另有 "+unclassified.length+" 位團別無法辨識，未列入；請檢查學生主檔團別。":"")+" 僅供核對，不會寫入資料庫或扣除庫存。";
 }catch(e){$("tshirtEligibilityPreview").textContent="匯出失敗："+e.message}
}
$("exportTshirtEligibility").addEventListener("click",()=>exportEligibility("current"));
$("exportTshirtFormerEligibility")?.addEventListener("click",()=>exportEligibility("archive"));
function parseCsv(src){
 const result=[],row=[];let value="",quoted=false;
 src=src.replace(/^\uFEFF/,"");
 for(let i=0;i<src.length;i++){
  const c=src[i];
  if(quoted){if(c==='"'&&src[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(value);value=""}
  else if(c==='\n'){row.push(value.replace(/\r$/,""));result.push([...row]);row.length=0;value=""}
  else value+=c;
 }
 if(quoted)throw Error("CSV 引號未關閉");
 if(value||row.length){row.push(value.replace(/\r$/,""));result.push([...row])}
 return result;
}
$("importTshirtEligibility").addEventListener("change",async e=>{
 const file=e.target.files?.[0],out=$("tshirtEligibilityPreview");if(!file)return;
 try{
  if(file.size>1024*1024)throw Error("檔案不得超過 1MB");
  const rows=parseCsv(await file.text()),head=rows.shift();
  const validHeader=Array.isArray(head)&&([headers,exportHeaders].some(allowed=>head.length===allowed.length&&allowed.every((h,i)=>head[i]===h))||[rosterExportHeaders].some(allowed=>head.length===allowed.length&&allowed.every((h,i)=>head[i]===h)));
  if(!validHeader)throw Error("CSV 欄位需符合舊版或新版匯出範本："+headers.join("、"));
  const ids=new Set(),errors=[],data=[];
  for(const [i,row] of rows.entries()){
   if(!row.some(v=>v.trim()))continue;
   const [id,name,group,eligible,issued,date,size,notes]=row;
   if(row.length!==head.length)errors.push("第 "+(i+2)+" 行：欄位數量不符");
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||""))errors.push("第 "+(i+2)+" 行：學生 ID 格式錯誤");
   if(ids.has(id))errors.push("第 "+(i+2)+" 行：重複學生 ID");
   ids.add(id);
   if(!["A","B","C","儲備團"].includes(group))errors.push("第 "+(i+2)+" 行：團別不正確");
   if(!statuses.has(eligible)||!statuses.has(issued))errors.push("第 "+(i+2)+" 行：資格與領用請使用 YES／NO／UNKNOWN");
   if(issued==="YES"&&eligible==="YES")errors.push("第 "+(i+2)+" 行：已領取卻仍標示免費可申請，需人工核對");
   if(issued==="YES"&&!date)errors.push("第 "+(i+2)+" 行：已領用但缺少日期（可填 UNKNOWN 待查）");
   data.push({id,name,group,eligible,issued,date,size,notes});
  }
  out.replaceChildren();
  const p=document.createElement("p");p.textContent="匯入預覽 "+data.length+" 筆；錯誤 "+errors.length+" 項。此功能不會寫入資料庫。";out.appendChild(p);
  if(errors.length){const list=document.createElement("ul");for(const msg of errors.slice(0,30)){const li=document.createElement("li");li.textContent=msg;list.appendChild(li)}out.appendChild(list)}
  const table=document.createElement("table");table.innerHTML="<thead><tr><th>學生 ID</th><th>姓名</th><th>團別</th><th>免費資格</th><th>首次已領</th><th>日期</th></tr></thead>";
  const body=document.createElement("tbody");for(const r of data.slice(0,100)){const tr=document.createElement("tr");for(const v of [r.id,r.name,r.group,r.eligible,r.issued,r.date]){const td=document.createElement("td");td.textContent=v;tr.appendChild(td)}body.appendChild(tr)}table.appendChild(body);out.appendChild(table);
 }catch(err){out.textContent="匯入預覽失敗："+err.message}
});
