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
const safe=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const count=(field,val)=>roster.filter(r=>r[field]===val).length;
const grouped=new Map();
for(const r of roster){const key=r[2]+"款 "+r[3];grouped.set(key,(grouped.get(key)||0)+1)}
const root=document.getElementById("competitionRosterPreview");
if(root){
 const sum=document.createElement("p");
 sum.textContent="已登記 "+roster.length+" 位｜租借 "+count(4,"租借")+"｜買斷 "+count(4,"買斷")+"｜待確認 "+count(4,"待確認")+"｜每位各 1 套（預計共 "+roster.length+" 套）";
 root.appendChild(sum);
 const note=document.createElement("p");note.textContent="依先前提供的名單建立展示資料；尚未核對學生 ID、庫存實物、付款與發放紀錄。";root.appendChild(note);
 const t=document.createElement("table");
 t.innerHTML="<thead><tr><th>班級</th><th>學生</th><th>款式</th><th>尺寸</th><th>取得方式</th><th>樂器</th><th>領用狀態</th></tr></thead><tbody>"+
 roster.map(r=>"<tr>"+r.map(c=>"<td>"+safe(c)+"</td>").join("")+"<td>未確認</td></tr>").join("")+"</tbody>";
 root.appendChild(t);
 const totals=document.createElement("p");
 totals.textContent="尺寸統計："+[...grouped].map(([k,v])=>k+" "+v+" 套").join("、");
 root.appendChild(totals);
 const btn=document.getElementById("exportCompetitionRoster");
 btn?.addEventListener("click",()=>{
  const rows=[["班級","學生姓名","款式","尺寸","取得方式","樂器","領用狀態"],...roster.map(r=>[...r,"未確認"])];
  const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download="A團比賽服_參考名單.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
}
