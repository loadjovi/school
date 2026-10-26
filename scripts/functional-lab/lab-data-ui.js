(()=>{
"use strict";
const q=id=>document.getElementById(id);
let preview=null,busy=false;
const message=q("lab-data-message"),summary=q("lab-data-summary");
function headers(){
  const token=sessionStorage.getItem("google_id_token"),school=sessionStorage.getItem("school_context_id");
  if(!token||sessionStorage.getItem("role_context")!=="schoolAdmin"||!school)throw Error("請先在此分頁登入完整平台，選擇學校管理員後，再由 SOP LAB 捷徑返回。");
  return {"Content-Type":"application/json","X-Google-ID-Token":token,"X-School-Id":school,"X-Role-Context":"schoolAdmin"};
}
async function request(method="GET",body){
  const response=await fetch("/api/sop-lab/fixtures"+(method==="GET"?"?view=database":""),{method,headers:headers(),cache:"no-store",credentials:"same-origin",...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"LAB 資料操作失敗（HTTP "+response.status+"）");
  return data;
}
function updateButtons(){
  q("lab-data-clear").disabled=busy||!preview||!preview.total;
  q("lab-data-restore").disabled=busy||!preview?.backup;
  for(const id of ["lab-data-refresh","lab-private-create","create-fixtures","lab-parent-bind"])q(id).disabled=busy;
}
async function refresh(){
  preview=null;updateButtons();summary.textContent="正在讀取目前 LAB 資料…";
  try{
    const data=await request();preview=data;
    summary.textContent="目前學校："+data.schoolId+"｜LAB："+data.storageAccount+"｜可清除測試資料 "+data.total+" 筆";
    const host=q("lab-data-tables");host.replaceChildren();
    const rows=data.tables.filter(x=>x.count>0);
    if(!rows.length){const p=document.createElement("p");p.textContent="目前沒有測試資料，可建立案例或從學生匯入開始。";host.append(p)}
    else for(const item of rows){const p=document.createElement("p");p.textContent=item.label+"："+item.count+" 筆";host.append(p)}
    q("lab-data-backup").textContent=data.backup?"最近清空前備份："+new Date(data.backup.createdAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})+"（"+data.backup.total+" 筆）":"尚無清空前備份；清空時會自動建立。";
  }catch(error){summary.textContent=error.message;throw error}
  finally{updateButtons()}
}
q("lab-data-refresh").addEventListener("click",()=>refresh().catch(error=>{message.textContent="⚠️ "+error.message}));
q("lab-data-clear").addEventListener("click",async()=>{
  if(!preview||busy)return;
  const plan=preview;
  if(!confirm("清空目前 LAB 學校「"+plan.schoolId+"」的 "+plan.total+" 筆測試資料？\n\n學生、老師及家長綁定、個課、出勤、評量、課表、團服庫存／申請與活動資料都會清除。\n\n系統先自動備份，再清空；保留管理員與財務權限、學校設定、操作稽核。請其他幹部暫停操作。"))return;
  busy=true;updateButtons();message.textContent="正在自動備份並清空 LAB 資料，請勿關閉此頁…";
  try{
    const data=await request("POST",{action:"RESET_LAB_DATA",confirmation:"CLEAR_CURRENT_LAB_SCHOOL",schoolId:plan.schoolId,planToken:plan.planToken});
    message.textContent="✅ "+data.message+"。清除 "+data.deleted+" 筆。下一步可建立完整 SOP 案例，或回完整平台匯入學生。";
    // Clear this browser's checklist only after the server has finished.
    localStorage.removeItem("school-sop-lab-checks-v1");
    window.dispatchEvent(new Event("lab-data-reset"));
    await refresh();
  }catch(error){message.textContent="⚠️ "+error.message;await refresh().catch(()=>{})}
  finally{busy=false;updateButtons()}
});
q("lab-data-restore").addEventListener("click",async()=>{
  if(!preview?.backup||busy)return;
  const plan=preview;
  if(!confirm("還原最近一次清空前的 "+plan.backup.total+" 筆 LAB 資料？\n\n若已有新的練習資料，系統會停止，不會覆蓋新成果。"))return;
  busy=true;updateButtons();message.textContent="正在驗證並還原備份…";
  try{
    const data=await request("POST",{action:"RESTORE_LAB_DATA",confirmation:"RESTORE_CURRENT_LAB_SCHOOL",schoolId:plan.schoolId,backupId:plan.backup.id});
    message.textContent="✅ "+data.message+"（本次補回 "+data.restored+" 筆）。";await refresh();
  }catch(error){message.textContent="⚠️ "+error.message}
  finally{busy=false;updateButtons()}
});
q("lab-private-create").addEventListener("click",async()=>{
  if(busy||!confirm("補齊目前 LAB 六位虛構學生的個課案例？\n\n只新增缺少資料，不會覆蓋已修改的老師綁定與上課紀錄；不寄通知信。若尚未建立學生，請先點「建立 SOP 測試資料」。"))return;
  busy=true;updateButtons();q("lab-private-message").textContent="正在建立個課案例…";
  try{
    const data=await request("POST",{action:"CREATE_PRIVATE_FIXTURES",confirmation:"CREATE_PRIVATE_FIXTURES"});
    q("lab-private-message").textContent="✅ "+data.message+"；新增 "+data.created+" 筆／保留既有 "+data.existing+" 筆。";await refresh();
  }catch(error){q("lab-private-message").textContent="⚠️ "+error.message}
  finally{busy=false;updateButtons()}
});
window.addEventListener("lab-fixtures-created",()=>refresh().catch(()=>{}));
refresh().catch(()=>{});
})();
