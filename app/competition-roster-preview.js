// A 團比賽服：人工提供之參考名單。僅展示，不寫入 Azure Table Storage。
const roster=[
["4A","林心澄","女","S","租借","小提琴"],
["4C","李旭恩","男","S","待確認","大提琴"],
["4D","蘇聖翔","男","M","待確認","中提琴"],
["5A","吳定廩","男","M","租借","大提琴"],
["5A","蔡昀潔","女","M","待確認","中提琴"],
["5C","游宜橙","女","M","買斷","小提琴"],
["5C","陳祉瑄","女","XS","租借","小提琴"],
["5D","楊力萓","女","S","買斷","大提琴"],
["6A","李婇寧","女","M","租借","小提琴"],
["6B","賴昺旭","男","S","租借","中提琴"],
["6C","張安侖","男","L","買斷","大提琴"],
["6C","黃禹閎","男","M","買斷","小提琴"],
["6C","陳奕亘","男","L","租借","中提琴"],
["6D","張介輔","男","L","租借","小提琴"],
["6D","李宥蓁","女","L","租借","大提琴"]
];

// 2026-10-11 領用佐證：使用者提供之「新A團」12人名冊。
// 紙本為上一學年度班級，今年均升一個年級。保留歷史班級，取得方式/尺寸不可由手寫註記推定。
const confirmedReceived=new Map([
 ["李婇寧","5A"],["張介輔","5D"],["林心澄","3A"],["黃禹閎","5C"],
 ["游宜橙","4A"],["陳祉瑄","4B"],["賴昺旭","5B"],["陳奕亘","5C"],
 ["張安侖","5C"],["李宥蓁","5D"],["吳定廩","4A"],["楊力萓","4D"]
]);

const promotedClass=value=>{const m=/^([1-6])([A-Z])$/.exec(value||"");return m?String(Number(m[1])+1)+m[2]:"待核對"};
const safe=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const count=(field,val)=>roster.filter(r=>r[field]===val).length;
const grouped=new Map();
for(const r of roster){const key=r[2]+"款 "+r[3];grouped.set(key,(grouped.get(key)||0)+1)}
const root=document.getElementById("competitionRosterPreview");
if(root){
 const sum=document.createElement("p");
 sum.textContent="已登記 "+roster.length+" 位｜租借 "+count(4,"租借")+"｜買斷 "+count(4,"買斷")+"｜待確認 "+count(4,"待確認")+"｜每位各 1 套（預計共 "+roster.length+" 套）";
 root.appendChild(sum);
 const received=document.createElement("p");received.textContent="去年紙本確認已領用 12 人，班級今年各升一個年級；另 3 人尚無本張紙本領用佐證（不代表未領）。款式、尺寸及公發／自費仍需逐人核對。";root.appendChild(received);
 const note=document.createElement("p");note.textContent="依先前提供的名單建立展示資料；尚未核對學生 ID、庫存實物、付款與發放紀錄。";root.appendChild(note);
 const t=document.createElement("table");
 t.innerHTML="<thead><tr><th>班級</th><th>學生</th><th>款式</th><th>尺寸</th><th>取得方式</th><th>樂器</th><th>領用狀態</th><th>去年紙本班級</th><th>今年班級</th></tr></thead><tbody>"+
 roster.map(r=>"<tr>"+r.map(c=>"<td>"+safe(c)+"</td>").join("")+"<td>"+(confirmedReceived.has(r[1])?"已領用（紙本確認）":"待核對")+"</td><td>"+safe(confirmedReceived.get(r[1])||"—")+"</td><td>"+safe(confirmedReceived.has(r[1])?promotedClass(confirmedReceived.get(r[1])):r[0])+"</td></tr>").join("")+"</tbody>";
 root.appendChild(t);
 const totals=document.createElement("p");
 totals.textContent="尺寸統計："+[...grouped].map(([k,v])=>k+" "+v+" 套").join("、");
 root.appendChild(totals);
 const btn=document.getElementById("exportCompetitionRoster");
 btn?.addEventListener("click",()=>{
  const rows=[["班級（原展示）","學生姓名","款式（待核）","尺寸（待核）","取得方式（歷史登記待核）","樂器","領用狀態","去年紙本班級","今年班級"],...roster.map(r=>[...r,confirmedReceived.has(r[1])?"已領用（紙本確認）":"待核對",confirmedReceived.get(r[1])||"",confirmedReceived.has(r[1])?promotedClass(confirmedReceived.get(r[1])):r[0]])];
  const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="A團比賽服_參考名單.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}

// 供公發服歸還預覽選單使用：僅既有 15 位參考名單，不代表已核實 studentId 或公發資產。
const selector=document.getElementById("competitionReturnStudent");
if(selector){
 const sorted=[...roster].sort((a,b)=>a[1].localeCompare(b[1],"zh-Hant"));
 for(const r of sorted){const option=document.createElement("option");option.value=r[1];option.textContent=r[1]+"（"+r[0]+"｜"+r[2]+"款 "+r[3]+"）";selector.appendChild(option)}
 const info=document.getElementById("competitionStudentInfo");
 selector.addEventListener("change",()=>{
  const match=roster.find(r=>r[1]===selector.value);
  if(!match){if(info)info.textContent="請選擇 A 團學生";return}
  const style=document.getElementById("competitionReturnStyle");style.value=match[2];style.dispatchEvent(new Event("change"));
  document.getElementById("competitionReturnSize").value=match[3];
  if(info)info.textContent="已帶入 "+match[0]+" "+match[1]+"｜"+match[2]+"款 "+match[3]+"｜歷史登記："+match[4]+"。此為名單尺寸，不代表已核對目前實際公發服，請確認後再操作。";
 });
}
