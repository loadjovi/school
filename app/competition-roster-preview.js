import {roster} from "./competition-roster-data.js";
import {confirmedReceived,promotedClass} from "./competition-paper-receipts.js";
const safe=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const count=(field,val)=>roster.filter(r=>r[field]===val).length;
const grouped=new Map();
for(const r of roster){const key=r[2]+"款 "+r[3];grouped.set(key,(grouped.get(key)||0)+1)}
const root=document.getElementById("competitionRosterPreview");
if(root){
 const stats=document.createElement("div");stats.className="competition-roster-stats";
 for(const [label,value] of [["名單人數",roster.length],["登記公費",count(4,"公費")],["登記買斷",count(4,"買斷")],["取得方式待確認",count(4,"待確認")]]){
  const card=document.createElement("div");card.className="competition-roster-stat";
  card.innerHTML="<span>"+label+"</span><strong>"+value+" 位</strong>";stats.appendChild(card);
 }
 root.appendChild(stats);
 const details=document.createElement("details");details.className="competition-roster-notes";
 details.innerHTML="<summary>資料來源與核對範圍</summary><p>這份名單列有 15 位學生及登記款式、尺寸。去年紙本確認 12 位已領用，另 3 位在該張紙本沒有領用佐證，仍須核對。</p><p>「今年班級」由去年紙本班級升一個年級供辨認。取得方式、款式、尺寸及領用情形尚需逐人核對；此名單沒有寫入正式發放、付款或庫存紀錄。</p>";
 root.appendChild(details);
 const wrap=document.createElement("div");wrap.className="competition-roster-table-wrap";
 const t=document.createElement("table");t.className="competition-roster-table";
 t.innerHTML="<thead><tr><th>學生／班級</th><th>款式與尺寸</th><th>取得方式</th><th>樂器</th><th>紙本領用</th><th>去年紙本班級</th><th>今年班級</th></tr></thead><tbody>"+
 roster.map(r=>{
  const paper=confirmedReceived.has(r[1]);
  const prior=confirmedReceived.get(r[1])||"—";
  const current=paper?promotedClass(prior):r[0];
  const modeClass=r[4]==="待確認"?" is-pending":"";
  return "<tr><td data-label=\"學生／班級\" class=\"roster-student\"><strong>"+safe(r[1])+"</strong><small>"+safe(current)+"</small></td>"+
   "<td data-label=\"款式與尺寸\"><strong>"+safe(r[2])+"款 · "+safe(r[3])+"</strong></td>"+
   "<td data-label=\"取得方式\"><span class=\"roster-pill"+modeClass+"\">"+safe(r[4])+"</span></td>"+
   "<td data-label=\"樂器\">"+safe(r[5])+"</td>"+
   "<td data-label=\"紙本領用\"><span class=\"roster-pill"+(paper?"":" is-pending")+"\">"+(paper?"紙本確認已領用":"待核對")+"</span></td>"+
   "<td data-label=\"去年紙本班級\">"+safe(prior)+"</td><td data-label=\"今年班級\">"+safe(current)+"</td></tr>";
 }).join("")+"</tbody>";
 wrap.appendChild(t);root.appendChild(wrap);
 const totals=document.createElement("p");totals.className="competition-roster-sizes";
 totals.textContent="名單尺寸統計："+[...grouped].map(([k,v])=>k+" "+v+" 套").join("、");root.appendChild(totals);
 document.getElementById("exportCompetitionRoster")?.addEventListener("click",()=>{
  const rows=[["班級（原展示）","學生姓名","款式（名單登記）","尺寸（名單登記）","取得方式（歷史登記待核）","樂器","領用狀態","去年紙本班級","今年班級"],...roster.map(r=>[...r,confirmedReceived.has(r[1])?"已領用（紙本確認）":"待核對",confirmedReceived.get(r[1])||"",confirmedReceived.has(r[1])?promotedClass(confirmedReceived.get(r[1])):r[0]])];
  const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="A團比賽服_參考名單.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
