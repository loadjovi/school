// 團T資格核對：匯出已取得的申請學生，不推斷未申請者；匯入只預覽，不寫入資料庫。
const $=id=>document.getElementById(id);
const headers=["studentId","studentName","group","firstFreeEligible","firstIssued","issuedAt","size","notes"];
const statuses=new Set(["YES","NO","UNKNOWN"]);
function download(rows){
 const csv="\uFEFF"+[headers,...rows].map(row=>row.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="團T_首次免費資格核對.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$("exportTshirtEligibility").addEventListener("click",async()=>{
 try{
  const headers=typeof window.uniformEventAuthHeaders==="function"?window.uniformEventAuthHeaders():{};
  const r=await fetch("/api/uniform-events/requests",{credentials:"same-origin",cache:"no-store",headers});
  if(r.status===401)throw Error("登入驗證失敗（HTTP 401）。請先返回平台首頁重新 Google 登入，再重新開啟管理頁。");
  if(r.status===403)throw Error("權限不足（HTTP 403）。請確認已切換為此校管理員身分。");
  if(!r.ok)throw Error("無法取得團T申請紀錄（HTTP "+r.status+"）");
  const data=await r.json(),rows=(data.items||[]).filter(x=>x.kind==="regularUniform");
  const map=new Map();
  for(const item of rows){
   if(!item.studentId)continue;
   if(!map.has(item.studentId))map.set(item.studentId,[item.studentId,item.studentName||"","", "UNKNOWN","UNKNOWN","","","待確認團別；115學年度 A/B 團已首次領取（李沛臻除外），尺寸未知；儲備團尚未領取。此非完整名冊"]);
  }
  download([...map.values()]);
  $("tshirtEligibilityPreview").textContent="已匯出 "+map.size+" 位有團T申請紀錄的學生。注意：這不是完整 A、B 團名冊；未申請者不會出現在檔案中，請由正式學生名冊補齊後再匯入預覽。";
 }catch(e){$("tshirtEligibilityPreview").textContent="匯出失敗："+e.message}
});
function parseCsv(src){
 const result=[],row=[];let value="",quoted=false;
 src=src.replace(/^\uFEFF/,"");
 for(let i=0;i<src.length;i++){
  const c=src[i];
  if(quoted){if(c==='"'&&src[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(value);value=""}
  else if(c==='\n'){row.push(value.replace(/\r$/,""));result.push([...row]);row.length=0;value=""}
  else value+=c;
 }
 if(quoted)throw Error("CSV 引號未關閉");
 if(value||row.length){row.push(value.replace(/\r$/,""));result.push([...row])}
 return result;
}
$("importTshirtEligibility").addEventListener("change",async e=>{
 const file=e.target.files?.[0],out=$("tshirtEligibilityPreview");if(!file)return;
 try{
  if(file.size>1024*1024)throw Error("檔案不得超過 1MB");
  const rows=parseCsv(await file.text()),head=rows.shift();
  if(!head||headers.some((h,i)=>head[i]!==h)||head.length!==headers.length)throw Error("CSV 欄位需依原範本順序："+headers.join("、"));
  const ids=new Set(),errors=[],data=[];
  for(const [i,row] of rows.entries()){
   if(!row.some(v=>v.trim()))continue;
   const [id,name,group,eligible,issued,date,size,notes]=row;
   if(row.length!==headers.length)errors.push("第 "+(i+2)+" 行：欄位數量不符");
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||""))errors.push("第 "+(i+2)+" 行：學生 ID 格式錯誤");
   if(ids.has(id))errors.push("第 "+(i+2)+" 行：重複學生 ID");
   ids.add(id);
   if(!["A","B","C","儲備團"].includes(group))errors.push("第 "+(i+2)+" 行：團別不正確");
   if(!statuses.has(eligible)||!statuses.has(issued))errors.push("第 "+(i+2)+" 行：資格與領用請使用 YES／NO／UNKNOWN");
   if(issued==="YES"&&eligible==="NO")errors.push("第 "+(i+2)+" 行：領用與資格矛盾，需人工核對");
   if(issued==="YES"&&!date)errors.push("第 "+(i+2)+" 行：已領用但缺少日期（可填 UNKNOWN 待查）");
   data.push({id,name,group,eligible,issued,date,size,notes});
  }
  out.replaceChildren();
  const p=document.createElement("p");p.textContent="匯入預覽 "+data.length+" 筆；錯誤 "+errors.length+" 項。此功能不會寫入資料庫。";out.appendChild(p);
  if(errors.length){const list=document.createElement("ul");for(const msg of errors.slice(0,30)){const li=document.createElement("li");li.textContent=msg;list.appendChild(li)}out.appendChild(list)}
  const table=document.createElement("table");table.innerHTML="<thead><tr><th>學生 ID</th><th>姓名</th><th>團別</th><th>免費資格</th><th>首次已領</th><th>日期</th></tr></thead>";
  const body=document.createElement("tbody");for(const r of data.slice(0,100)){const tr=document.createElement("tr");for(const v of [r.id,r.name,r.group,r.eligible,r.issued,r.date]){const td=document.createElement("td");td.textContent=v;tr.appendChild(td)}body.appendChild(tr)}table.appendChild(body);out.appendChild(table);
 }catch(err){out.textContent="匯入預覽失敗："+err.message}
});
