// 使用者 2026-10-11 確認之團T盤點。此模組僅供畫面預覽與 CSV 匯出，不會寫入 Azure Storage。
const initial={"8":1,"10":0,"12":3,"14":0,"XS":5,"S":1,"M":3,"L":1,"XL":1,"2L":0};
const sizes=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
const counts={...initial};
let confirmedAt=null;
let confirmedBy="";
const confirmedSnapshots=[];
const root=document.getElementById("tshirtStockPreview");
function render(){
 const known=sizes.filter(s=>Number.isInteger(counts[s]));
 const total=known.reduce((sum,s)=>sum+counts[s],0);
 const table=document.createElement("table");
 const heading=document.createElement("p");
 heading.textContent="已確認 "+known.length+" 種尺寸，共 "+total+" 件；其他尺寸待盤點。";
 root.replaceChildren(heading);
 const note=document.createElement("p");note.textContent=confirmedAt?"本次預覽確認："+confirmedAt+"，盤點人員："+confirmedBy:"尚未確認本次盤點（此頁僅預覽，不會儲存到資料庫）";root.appendChild(note);
 const thead=document.createElement("thead");thead.innerHTML="<tr><th>尺寸</th><th>盤點數量</th><th>狀態</th></tr>";table.appendChild(thead);
 const tbody=document.createElement("tbody");
 for(const size of sizes){
  const tr=document.createElement("tr");
  const name=document.createElement("td");name.textContent=size;
  const cell=document.createElement("td");const input=document.createElement("input");
  input.type="number";input.min="0";input.max="100000";input.step="1";input.style.maxWidth="110px";
  input.placeholder="待盤點";input.value=counts[size]??"";
  input.setAttribute("aria-label",size+" 號庫存數量");
  input.addEventListener("change",()=>{
   if(input.value==="")delete counts[size];
   else if(/^\d+$/.test(input.value)&&Number(input.value)<=100000)counts[size]=Number(input.value);
   else{alert("請輸入 0 至 100000 的整數，或留空表示待盤點");input.value=counts[size]??"";return}
   confirmedAt=null;confirmedBy="";render();
  });
  cell.appendChild(input);
  const state=document.createElement("td");state.textContent=Number.isInteger(counts[size])?"已盤點":"待盤點";
  tr.append(name,cell,state);tbody.appendChild(tr);
 }
 table.appendChild(tbody);root.appendChild(table);
}
render();
document.getElementById("exportTshirtStockPreview")?.addEventListener("click",()=>{
 const rows=[["key","onHand","status","confirmedAt","confirmedBy"],...sizes.map(size=>["regular:"+size,counts[size]??"",Number.isInteger(counts[size])?"已盤點":"待盤點",confirmedAt||"",confirmedBy||""])];
 const csv="\uFEFF"+rows.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="團T_盤點預覽.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

const check=document.createElement("section");
check.innerHTML='<h3>學期末盤點確認（預覽）</h3><label>盤點人員（幹部或老師）<input id="stockCheckerName" maxlength="80" placeholder="請輸入姓名"></label><label><input id="stockCheckAgree" type="checkbox" style="display:inline;width:auto"> 我已核對本次各尺寸庫存數量</label><button id="stockCheckConfirm" type="button">確認本次盤點（預覽）</button><p id="stockCheckMessage" class="warn">本功能僅供驗收畫面，不會寫入正式盤點紀錄。</p>';
root.after(check);
document.getElementById("stockCheckConfirm").addEventListener("click",()=>{
 const name=document.getElementById("stockCheckerName").value.trim();
 if(!name||!document.getElementById("stockCheckAgree").checked){document.getElementById("stockCheckMessage").textContent="請填寫盤點人員並勾選確認";return}
 const unknown=sizes.filter(size=>!Number.isInteger(counts[size]));
 if(unknown.length){document.getElementById("stockCheckMessage").textContent="尚有未盤點尺寸："+unknown.join("、")+"；請先完成所有尺寸盤點，0 件請填 0。";return}
 confirmedAt=new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false});confirmedBy=name;
 confirmedSnapshots.push({confirmedAt,confirmedBy,counts:{...counts}});
 document.getElementById("stockCheckMessage").textContent="已產生本頁盤點確認預覽。請匯出 CSV 保存；尚未寫入資料庫。";
 render();
});
