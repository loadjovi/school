import {roster} from "./competition-roster-data.js";
import {confirmedReceived,promotedClass} from "./competition-paper-receipts.js";

const safe=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const count=(field,value)=>roster.filter(row=>row[field]===value).length;
const currentClass=row=>confirmedReceived.has(row[1])?promotedClass(confirmedReceived.get(row[1])):row[0];
const list=[...roster].sort((a,b)=>currentClass(a).localeCompare(currentClass(b),"en",{numeric:true})||a[1].localeCompare(b[1],"zh-Hant"));
const root=document.getElementById("competitionRosterPreview");
if(root){
 const summary=document.createElement("p");summary.className="competition-roster-summary";
 summary.textContent="共 "+list.length+" 位｜已確認領用 "+[...confirmedReceived.keys()].filter(name=>list.some(row=>row[1]===name)).length+" 位｜領用待核對 "+list.filter(row=>!confirmedReceived.has(row[1])).length+" 位｜取得方式待確認 "+count(4,"待確認")+" 位";
 root.appendChild(summary);
 const hint=document.createElement("p");hint.className="competition-roster-order";
 hint.textContent="依今年班級由低至高排序，同班依姓名排序。點選學生可查看樂器與原班級。";
 root.appendChild(hint);
 const container=document.createElement("div");container.className="competition-roster-groups";
 let grade="";
 for(const row of list){
  const klass=currentClass(row);
  const nextGrade=/^([1-6])/.exec(klass)?.[1]||"其他";
  if(nextGrade!==grade){
   grade=nextGrade;
   const heading=document.createElement("h3");heading.className="competition-roster-group-title";
   heading.textContent=(grade==="其他"?"其他班級":grade+" 年級");container.appendChild(heading);
  }
  const received=confirmedReceived.has(row[1]);
  const details=document.createElement("details");details.className="competition-roster-row";
  details.innerHTML="<summary><span class=\"roster-identity\"><span class=\"roster-class\">"+safe(klass)+"</span><strong>"+safe(row[1])+"</strong></span>"+
   "<span class=\"roster-size\">"+safe(row[2])+"款 · "+safe(row[3])+"</span>"+
   "<span class=\"roster-status"+(received?"":" is-pending")+"\">"+(received?"已確認領用":"領用待核對")+"</span>"+
   "<span class=\"roster-expand\" aria-hidden=\"true\">⌄</span></summary>"+
   "<div class=\"roster-row-extra\"><span>取得方式：<strong>"+safe(row[4])+"</strong></span><span>樂器："+safe(row[5])+"</span>"+
   "<span>去年班級："+safe(confirmedReceived.get(row[1])||"待核對")+"</span></div>";
  container.appendChild(details);
 }
 root.appendChild(container);
 const details=document.createElement("details");details.className="competition-roster-notes";
 details.innerHTML="<summary>名單來源及尺寸統計</summary><p>名單中的款式、尺寸及取得方式仍可逐人核對；已確認領用的學生依既有確認名單顯示，其他學生顯示「領用待核對」。名單尚未逐筆建立系統領用及庫存異動紀錄。</p>";
 const grouped=new Map();for(const row of list){const key=row[2]+"款 "+row[3];grouped.set(key,(grouped.get(key)||0)+1)}
 const sizes=document.createElement("p");sizes.textContent="尺寸統計："+[...grouped].map(([key,value])=>key+" "+value+" 套").join("、");details.appendChild(sizes);
 root.appendChild(details);
 document.getElementById("exportCompetitionRoster")?.addEventListener("click",()=>{
  const rows=[["今年班級","學生姓名","款式（名單登記）","尺寸（名單登記）","取得方式（待逐人核對）","樂器","領用狀態","去年班級"],...list.map(row=>[currentClass(row),row[1],row[2],row[3],row[4],row[5],confirmedReceived.has(row[1])?"已確認領用":"領用待核對",confirmedReceived.get(row[1])||""])];
  const csv="\uFEFF"+rows.map(values=>values.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="A團比賽服_學生尺寸核對.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
