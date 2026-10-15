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
const records=[];
document.getElementById("competitionReturnPreviewAdd").addEventListener("click",()=>{
 const student=document.getElementById("competitionReturnStudent").value.trim();
 if(!student){alert("請填寫學生姓名");return}
 records.push({student,style:styleEl.value,size:sizeEl.value,status:document.getElementById("competitionReturnStatus").value,at:new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false})});
 const root=document.getElementById("competitionReturnPreview");
 root.replaceChildren();
 const heading=document.createElement("p");heading.textContent="本頁歸還紀錄（重新整理即消失，尚未入庫）";root.appendChild(heading);
 const t=document.createElement("table");t.innerHTML="<thead><tr><th>學生</th><th>款式</th><th>尺寸</th><th>處理狀態</th><th>記錄時間</th></tr></thead>";
 const tb=document.createElement("tbody");
 for(const r of records){const tr=document.createElement("tr");for(const value of [r.student,r.style,r.size,r.status,r.at]){const td=document.createElement("td");td.textContent=value;tr.appendChild(td)}tb.appendChild(tr)}
 t.appendChild(tb);root.appendChild(t);
});
