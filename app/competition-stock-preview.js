// The stock summary is fed by the same API result as the editable inventory below.
// The return form remains a separate, non-persistent preview.
const sizes={"男":["S","M","L","2L"],"女":["XS","S","M","L"]};
const stock=document.getElementById("competitionStockPreview");
const table=document.createElement("table");
table.innerHTML="<thead><tr><th>款式</th><th>尺寸</th><th>目前可用庫存</th></tr></thead>";
const body=document.createElement("tbody");
function renderStock(items){
 const byKey=new Map(items.map(item=>[item.key,item]));body.replaceChildren();
 for(const style of ["男","女"])for(const size of sizes[style]){
  const item=byKey.get("competition:"+style+":"+size),tr=document.createElement("tr");
  const available=item?Number(item.onHand)-Number(item.reserved||0)-Number(item.unavailable||0):null;
  for(const value of [style+"款",size,item?available+" 件（現有 "+item.onHand+" 件）":"待盤點／未建檔"]){
   const td=document.createElement("td");td.textContent=value;tr.appendChild(td);
  }
  body.appendChild(tr);
 }
 document.getElementById("competitionStockSummary").textContent="依正式庫存即時顯示；已建檔 0 件代表目前無貨，待盤點代表尚無庫存紀錄。";
}
window.addEventListener("uniformInventoryLoaded",event=>renderStock(event.detail.items||[]));
window.addEventListener("uniformInventoryLoadFailed",event=>{
 body.replaceChildren();document.getElementById("competitionStockSummary").textContent="正式庫存讀取失敗："+event.detail.message;
});
table.appendChild(body);stock.appendChild(table);
if(Array.isArray(window.uniformInventoryItems))renderStock(window.uniformInventoryItems);
