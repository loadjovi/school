// 僅呈現 Azure 庫存資料；不使用歷史盤點草稿作為正式庫存。
const sizes=["8","10","12","14","XS","S","M","L","XL","2L","3L","5L"];
const root=document.getElementById("tshirtStockPreview");
let loaded=false;
let inventoryItems=[];
let error="";
function render(){
 if(!root)return;
 root.replaceChildren();
 const status=document.createElement("p");
 if(error){status.textContent="庫存資料讀取失敗："+error;root.append(status);return}
 if(!loaded){status.textContent="正在讀取正式庫存…";root.append(status);return}
 const rows=inventoryItems.filter(x=>typeof x.key==="string"&&x.key.startsWith("regular:"));
 const bySize=new Map(rows.map(x=>[x.key.slice(8),x]));
 const total=rows.reduce((n,x)=>n+(Number(x.onHand)||0),0);
 status.textContent="已建檔 "+rows.length+" 種尺寸，庫存合計 "+total+" 件。未建檔尺寸不代表 0 件，須由幹部完成盤點。";
 root.append(status);
 const table=document.createElement("table"),thead=document.createElement("thead"),tbody=document.createElement("tbody");
 thead.innerHTML="<tr><th>尺寸</th><th>正式庫存</th><th>資料狀態</th></tr>";
 for(const size of sizes){
  const row=bySize.get(size),tr=document.createElement("tr");
  const name=document.createElement("td"),qty=document.createElement("td"),state=document.createElement("td");
  name.textContent=size;
  qty.textContent=row?String(row.onHand)+" 件":"—";
  state.textContent=row?"已建檔":"待盤點／未建檔";
  if(!row){state.style.color="#8a641b";qty.style.color="#6b7280"}
  tr.append(name,qty,state);tbody.append(tr);
 }
 table.append(thead,tbody);root.append(table);
 const note=document.createElement("p");
 note.textContent="此表僅供查詢，不可直接修改。請使用下方「庫存盤點與調整」儲存數量；儲存後重新讀取資料庫。";
 root.append(note);
}
window.addEventListener("uniformInventoryLoaded",event=>{
 inventoryItems=Array.isArray(event.detail?.items)?event.detail.items:[];
 loaded=true;error="";render();
});
window.addEventListener("uniformInventoryLoadFailed",event=>{
 error=String(event.detail?.message||"無法取得資料");render();
});
document.getElementById("exportTshirtStockPreview")?.addEventListener("click",()=>{
 if(!loaded||error){alert("請先成功載入正式庫存");return}
 const bySize=new Map(inventoryItems.filter(x=>x.key?.startsWith("regular:")).map(x=>[x.key.slice(8),x]));
 const lines=[["尺寸","正式庫存","狀態"],...sizes.map(size=>[size,bySize.has(size)?bySize.get(size).onHand:"",bySize.has(size)?"已建檔":"待盤點／未建檔"])];
 const csv="\uFEFF"+lines.map(line=>line.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="團T_正式庫存.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();
