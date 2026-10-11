// 使用者 2026-10-11 確認之團T盤點。此模組僅供畫面預覽與 CSV 匯出，不會寫入 Azure Storage。
const initial={"8":1,"12":3,"XS":5,"S":1,"M":3,"L":1,"XL":1};
const sizes=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
const counts={...initial};
const root=document.getElementById("tshirtStockPreview");
function render(){
 const known=sizes.filter(s=>Number.isInteger(counts[s]));
 const total=known.reduce((sum,s)=>sum+counts[s],0);
 const table=document.createElement("table");
 const heading=document.createElement("p");
 heading.textContent="已確認 "+known.length+" 種尺寸，共 "+total+" 件；其他尺寸待盤點。";
 root.replaceChildren(heading);
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
   render();
  });
  cell.appendChild(input);
  const state=document.createElement("td");state.textContent=Number.isInteger(counts[size])?"已盤點":"待盤點";
  tr.append(name,cell,state);tbody.appendChild(tr);
 }
 table.appendChild(tbody);root.appendChild(table);
}
render();
document.getElementById("exportTshirtStockPreview")?.addEventListener("click",()=>{
 const rows=[["key","onHand","status"],...sizes.map(size=>["regular:"+size,counts[size]??"",Number.isInteger(counts[size])?"已盤點":"待盤點"])];
 const csv="\uFEFF"+rows.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="團T_盤點預覽.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
