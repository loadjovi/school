import {roster} from "./competition-roster-data.js";
import {confirmedReceived,promotedClass} from "./competition-paper-receipts.js";
// A 團比賽服：人工提供之參考名單。僅展示，不寫入 Azure Table Storage。


// 2026-10-11 領用佐證：使用者提供之「新A團」12人名冊。
// 紙本為上一學年度班級，今年均升一個年級。保留歷史班級，取得方式/尺寸不可由手寫註記推定。
const safe=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const count=(field,val)=>roster.filter(r=>r[field]===val).length;
const grouped=new Map();
for(const r of roster){const key=r[2]+"款 "+r[3];grouped.set(key,(grouped.get(key)||0)+1)}
const root=document.getElementById("competitionRosterPreview");
if(root){
 const sum=document.createElement("p");
 sum.textContent="已登記 "+roster.length+" 位｜公費 "+count(4,"公費")+"｜買斷 "+count(4,"買斷")+"｜待確認 "+count(4,"待確認")+"｜每位各 1 套（預計共 "+roster.length+" 套）";
 root.appendChild(sum);
 const received=document.createElement("p");received.textContent="去年紙本確認已領用 12 人，班級今年各升一個年級；另 3 人尚無本張紙本領用佐證（不代表未領）。款式與尺寸依目前名單登記；公發／自費及正式領用仍需逐人核對。";root.appendChild(received);
 const note=document.createElement("p");note.textContent="依先前提供的名單建立展示資料；尚未核對學生 ID、庫存實物、付款與發放紀錄；款式及尺寸為名單登記值。";root.appendChild(note);
 const t=document.createElement("table");
 t.innerHTML="<thead><tr><th>班級</th><th>學生</th><th>款式</th><th>尺寸</th><th>取得方式</th><th>樂器</th><th>領用狀態</th><th>去年紙本班級</th><th>今年班級</th></tr></thead><tbody>"+
 roster.map(r=>"<tr>"+r.map(c=>"<td>"+safe(c)+"</td>").join("")+"<td>"+(confirmedReceived.has(r[1])?"已領用（紙本確認）":"待核對")+"</td><td>"+safe(confirmedReceived.get(r[1])||"—")+"</td><td>"+safe(confirmedReceived.has(r[1])?promotedClass(confirmedReceived.get(r[1])):r[0])+"</td></tr>").join("")+"</tbody>";
 root.appendChild(t);
 const totals=document.createElement("p");
 totals.textContent="尺寸統計："+[...grouped].map(([k,v])=>k+" "+v+" 套").join("、");
 root.appendChild(totals);
 const btn=document.getElementById("exportCompetitionRoster");
 btn?.addEventListener("click",()=>{
  const rows=[["班級（原展示）","學生姓名","款式（名單登記）","尺寸（名單登記）","取得方式（歷史登記待核）","樂器","領用狀態","去年紙本班級","今年班級"],...roster.map(r=>[...r,confirmedReceived.has(r[1])?"已領用（紙本確認）":"待核對",confirmedReceived.get(r[1])||"",confirmedReceived.has(r[1])?promotedClass(confirmedReceived.get(r[1])):r[0]])];
  const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="A團比賽服_參考名單.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}

