import {roster} from "./competition-roster-data.js";
import {confirmedReceived,promotedClass} from "./competition-paper-receipts.js";

const safe=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const normalize=value=>String(value||"").trim().normalize("NFC");
const count=(field,value)=>roster.filter(row=>row[field]===value).length;
const currentClass=row=>confirmedReceived.has(row[1])?promotedClass(confirmedReceived.get(row[1])):row[0];
const list=[...roster].sort((a,b)=>currentClass(a).localeCompare(currentClass(b),"en",{numeric:true})||a[1].localeCompare(b[1],"zh-Hant"));
const root=document.getElementById("competitionRosterPreview");
if(root){
 let returned=new Map(),loaded=false;
 const date=value=>value?new Date(value).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}):"";
 function render(){
  root.replaceChildren();
  const summary=document.createElement("p");summary.className="competition-roster-summary";
  const returnedCount=list.filter(row=>returned.has(normalize(row[1]))).length;
  summary.textContent="共 "+list.length+" 位｜目前無比賽服 "+returnedCount+" 位｜已確認領用 "+list.filter(row=>confirmedReceived.has(row[1])&&!returned.has(normalize(row[1]))).length+" 位｜領用待核對 "+list.filter(row=>!confirmedReceived.has(row[1])&&!returned.has(normalize(row[1]))).length+" 位｜取得方式待確認 "+count(4,"待確認")+" 位";
  root.appendChild(summary);
  const hint=document.createElement("p");hint.className="competition-roster-order";
  hint.textContent="依今年班級由低至高排序，同班依姓名排序。已入庫者的款式與尺寸僅供查閱原領用紀錄。";
  root.appendChild(hint);
  const container=document.createElement("div");container.className="competition-roster-table-wrap";
  const table=document.createElement("table");table.className="competition-roster-table";
  table.innerHTML='<thead><tr><th scope="col">學生</th><th scope="col">款式／尺寸</th><th scope="col">取得方式</th><th scope="col">領用狀態</th></tr></thead>';
  const body=document.createElement("tbody");
  for(const row of list){
   const klass=currentClass(row),returnRecord=returned.get(normalize(row[1]));
   const received=confirmedReceived.has(row[1]);
   const tr=document.createElement("tr");
   tr.innerHTML='<td><strong>'+safe(row[1])+'</strong><small class="competition-class">'+safe(klass)+'</small></td>'+
    '<td><strong>'+safe(row[2])+'款 · '+safe(row[3])+'</strong>'+(returnRecord?'<small>原領用</small>':'')+'</td>'+
    '<td>'+safe(row[4])+'</td>'+
    '<td><details class="competition-roster-detail"><summary class="roster-status'+(returnRecord||!received?' is-pending':'')+'">'+
    (returnRecord?'已歸還入庫':received?'已確認領用':'領用待核對')+'</summary><div>樂器：'+safe(row[5])+'<br>去年班級：'+safe(confirmedReceived.get(row[1])||'待核對')+
    (returnRecord?'<br>目前持有：無'+(date(returnRecord.stockedAt)?'<br>入庫日期：'+safe(date(returnRecord.stockedAt)):''):'')+'</div></details></td>';
   body.appendChild(tr);
  }
  table.appendChild(body);container.appendChild(table);
  root.appendChild(container);
  const details=document.createElement("details");details.className="competition-roster-notes";
  details.innerHTML="<summary>名單來源及尺寸統計</summary><p>款式與尺寸保留原登記資料；歸還入庫以正式紀錄更新目前持有狀態。其他學生仍依既有領用核對名單顯示，尚未逐筆連結所有歷史發放紀錄。</p>";
  const grouped=new Map();for(const row of list){if(returned.has(normalize(row[1])))continue;const key=row[2]+"款 "+row[3];grouped.set(key,(grouped.get(key)||0)+1)}
  const sizes=document.createElement("p");sizes.textContent="未歸還名單登記尺寸："+[...grouped].map(([key,value])=>key+" "+value+" 套").join("、");details.appendChild(sizes);
  root.appendChild(details);
 }
 function applyReturns(data){
  const stocked=(data?.items||[]).filter(item=>item.status==="STOCKED").sort((a,b)=>String(a.stockedAt||"").localeCompare(String(b.stockedAt||"")));
  const issues=data?.issues||[];
  const names=new Map();for(const row of list){const name=normalize(row[1]);names.set(name,(names.get(name)||0)+1)}
  returned=new Map();for(const item of stocked){
   const name=normalize(item.studentName);
   if(names.get(name)!==1)continue;
   const newerIssue=issues.some(issue=>String(issue.studentId)===String(item.studentId)&&issue.issuedAt&&String(issue.issuedAt)>String(item.stockedAt||""));
   if(!newerIssue)returned.set(name,item);
  }
  loaded=true;render();
 }
 async function reload(){
  try{
   const response=await fetch("/api/uniform-events/competition-returns",{credentials:"same-origin",cache:"no-store",headers:window.uniformEventAuthHeaders?.()||{}});
   if(!response.ok)throw Error("HTTP "+response.status);
   applyReturns(await response.json());
  }catch(error){if(!loaded){const hint=root.querySelector(".competition-roster-order");if(hint)hint.textContent="歸還紀錄暫時無法讀取，請重新整理後再核對學生是否持有比賽服。"}}
 }
 render();
 window.addEventListener("uniformAdminAuth",event=>{if(event.detail?.authenticated)reload()});
 window.addEventListener("competitionReturnsUpdated",event=>applyReturns(event.detail));
 document.getElementById("exportCompetitionRoster")?.addEventListener("click",()=>{
  if(!loaded){alert("歸還紀錄尚未載入，請稍後再匯出，避免將已歸還學生列為仍持有。");return}
  const rows=[["今年班級","學生姓名","款式（原登記）","尺寸（原登記）","取得方式","樂器","目前比賽服狀態","歸還入庫日期","去年班級"],...list.map(row=>{const item=returned.get(normalize(row[1]));return [currentClass(row),row[1],row[2],row[3],row[4],row[5],item?"已歸還入庫／目前無比賽服":confirmedReceived.has(row[1])?"已確認領用":"領用待核對",item?date(item.stockedAt):"",confirmedReceived.get(row[1])||""]})];
  const csv="\uFEFF"+rows.map(values=>values.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="A團比賽服_學生尺寸核對.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
