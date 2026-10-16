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
const styleEl=document.getElementById("competitionReturnStyle"),sizeEl=document.getElementById("competitionReturnSize");
function syncSizes(){sizeEl.replaceChildren(...sizes[styleEl.value].map(x=>new Option(x,x)))}
styleEl.addEventListener("change",syncSizes);syncSizes();
const preview=document.getElementById("competitionReturnPreview");
for(const id of ["competitionReturnStudent","competitionReturnStyle","competitionReturnSize","competitionReturnStatus"]){
 document.getElementById(id).addEventListener("change",()=>preview.replaceChildren());
}
document.getElementById("competitionReturnPreviewAdd").addEventListener("click",()=>{
 const student=document.getElementById("competitionReturnStudent").value.trim();
 if(!student){preview.textContent="請先選擇 A 團學生。";return}
 const heading=document.createElement("strong");heading.textContent="歸還流程預覽（未儲存）";
 const detail=document.createElement("p");detail.textContent=student+"｜"+styleEl.value+"款 "+sizeEl.value+"｜"+document.getElementById("competitionReturnStatus").selectedOptions[0].textContent;
 const note=document.createElement("p");note.textContent="僅供核對流程；不會新增歸還紀錄、變更庫存或發送通知。";
 preview.replaceChildren(heading,detail,note);
});
