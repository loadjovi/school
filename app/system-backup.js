(()=>{
  state.systemBackup=state.systemBackup||{backup:null,restoreFile:null,preview:null,loading:false,error:""};
  const tableLabels={
    StudentMaster:"學生主檔",SemesterEnrollment:"學期正式名單",UserStudentMap:"家長 Gmail 綁定",
    StudentRegistration:"家長申請",TeacherDirectory:"老師帳號",TeacherProfile:"老師權限",
    PracticeLog:"自主練習",SectionAttendance:"分部課",EnsembleAttendance:"合奏課",
    ComprehensiveAttendance:"綜合課",PrivateLesson:"個別課",StudentHistory:"學生異動歷史",
    AcademicYearBatch:"學年度批次紀錄",SystemSettings:"系統設定"
  };
  function filenameStamp(){const d=new Date(),p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`}
  function downloadJson(name,data){
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("讀取備份檔失敗"));r.onload=()=>resolve(String(r.result||""));r.readAsText(file,"utf-8")})}
  function countsHtml(stats){
    const counts=stats?.counts||{};
    return `<div class="grid" style="margin-top:10px">${Object.keys(tableLabels).map(k=>`<div class="kpi"><b>${Number(counts[k]||0)}</b><span>${esc(tableLabels[k])}</span></div>`).join("")}</div><div class="notice" style="margin-top:10px">總資料筆數：<b>${Number(stats?.total||0)}</b></div>`;
  }
  window.downloadFullSystemBackup=async function(){
    if(state.systemBackup.loading)return;
    state.systemBackup.loading=true;state.systemBackup.error="";mountSystemBackup();
    try{
      const d=await api("/api/system-backup");state.systemBackup.backup=d;
      downloadJson(`聖心弦樂團_完整系統備份_${filenameStamp()}.json`,d);
      toast(`✅ 完整備份完成，共 ${d.stats?.total||0} 筆資料`);
    }catch(e){state.systemBackup.error=e.message||String(e);toast("❌ 備份失敗："+(e.message||e))}
    state.systemBackup.loading=false;mountSystemBackup();
  };
  window.selectSystemBackupFile=async function(input){
    const file=input?.files?.[0];state.systemBackup.preview=null;state.systemBackup.restoreFile=null;state.systemBackup.error="";
    if(!file){mountSystemBackup();return}
    try{
      if(file.size>50*1024*1024)throw new Error("備份檔超過 50MB，請先確認檔案是否正確");
      const txt=await readFile(file),backup=JSON.parse(txt);state.systemBackup.restoreFile=backup;
      state.systemBackup.loading=true;mountSystemBackup();
      const p=await api("/api/system-backup",{method:"POST",body:JSON.stringify({action:"preview",backup})});
      state.systemBackup.preview=p;toast("✅ 備份檔驗證完成");
    }catch(e){state.systemBackup.restoreFile=null;state.systemBackup.preview=null;state.systemBackup.error=e.message||String(e);toast("❌ "+(e.message||e))}
    state.systemBackup.loading=false;mountSystemBackup();
  };
  window.restoreSystemBackup=async function(mode){
    const backup=state.systemBackup.restoreFile,p=state.systemBackup.preview;if(!backup||!p){toast("請先選擇並驗證備份檔");return}
    const replace=mode==="replace";
    if(replace){
      const text=prompt("完整移轉會先清空目前資料表，再以備份檔重建。\n\n請輸入「完整移轉」確認：","");
      if(text!=="完整移轉"){toast("已取消完整移轉");return}
      if(!confirm(`最後確認：將清空目前系統資料，再還原備份中的 ${p.stats?.total||0} 筆資料。\n\n建議先下載目前系統完整備份。確定繼續？`))return;
    }else if(!confirm(`合併還原會依 PartitionKey + RowKey 更新/新增 ${p.stats?.total||0} 筆資料，不會先清空現有資料。\n\n確定繼續？`))return;
    state.systemBackup.loading=true;state.systemBackup.error="";mountSystemBackup();
    try{
      const body={action:"restore",mode,backup};
      if(replace)body.confirmText="完整移轉";else body.confirmRestore=true;
      const d=await api("/api/system-backup",{method:"POST",body:JSON.stringify(body)});
      toast(`✅ ${replace?"完整移轉":"合併還原"}完成，共還原 ${d.totalRestored||0} 筆資料`);
      state.systemBackup.preview=null;state.systemBackup.restoreFile=null;
    }catch(e){state.systemBackup.error=e.message||String(e);toast("❌ 還原失敗："+(e.message||e))}
    state.systemBackup.loading=false;mountSystemBackup();
  };
  function exportHtml(){
    const b=state.systemBackup.backup;
    return `<div class="item"><div><b>下載完整系統備份</b><small>備份學生、每學期名單、家長 Gmail、老師權限、自主練習、所有課程出勤、個別課、歷史異動與系統設定。</small></div></div><button class="primary" onclick="downloadFullSystemBackup()" ${state.systemBackup.loading?"disabled":""}>${state.systemBackup.loading?"正在處理…":"💾 下載完整備份 JSON"}</button>${b?`<div class="notice" style="margin-top:10px">最近一次備份：${esc(String(b.exportedAt||""))}<br>SHA-256：<small>${esc(String(b.checksum||""))}</small></div>${countsHtml(b.stats)}`:""}`;
  }
  function restoreHtml(){
    const p=state.systemBackup.preview;
    return `<div class="notice" style="margin-top:14px"><b>資料移轉／災難復原</b><br>在新 Azure 環境先完成環境變數與管理員 Gmail 設定，登入後上傳此 JSON，即可把資料還原到新的 Storage Account。</div><label>備份 JSON 檔</label><input type="file" accept=".json,application/json" onchange="selectSystemBackupFile(this)" ${state.systemBackup.loading?"disabled":""}>${p?`<div class="notice" style="margin-top:10px">✅ 備份檔驗證成功<br>備份時間：${esc(p.exportedAt||"—")}<br>格式版本：${esc(String(p.schemaVersion||""))}<br>檢查碼：<small>${esc(p.checksum||"—")}</small></div>${countsHtml(p.stats)}<div class="row2" style="margin-top:12px"><button class="secondary" onclick="restoreSystemBackup('merge')" ${state.systemBackup.loading?"disabled":""}>↗️ 合併還原</button><button class="primary" onclick="restoreSystemBackup('replace')" ${state.systemBackup.loading?"disabled":""}>🚚 完整移轉還原</button></div>`:""}`;
  }
  function environmentHtml(){return `<details style="margin-top:14px"><summary><b>🔐 新環境仍需另外設定的項目</b></summary><div class="notice" style="margin-top:8px">備份檔<b>不包含祕密值</b>。搬到新 Azure 時仍需重新設定：<br><br>• STORAGE_CONNECTION_STRING<br>• ADMIN_EMAILS<br>• GOOGLE_CLIENT_ID<br>• ACS_EMAIL_CONNECTION_STRING／ACS_EMAIL_SENDER（如使用 Email）<br>• PRACTICE_QUALIFIED_MINUTES／PRACTICE_TARGET_DAYS<br><br>這樣即使備份檔外流，也不會把 Azure Storage 金鑰或 Google/Email 憑證一起洩漏。</div></details>`}
  function mountSystemBackup(){
    if(state.me?.role!=="admin"||state.page!=="admin")return;
    const main=document.querySelector(".main");if(!main)return;
    let root=document.getElementById("systemBackupPanel");
    if(!root){root=document.createElement("div");root.id="systemBackupPanel";main.appendChild(root)}
    root.innerHTML=`<div class="card"><h2>💾 系統完整備份／資料移轉</h2><div class="notice"><b>這不是一般 Excel 名單備份。</b><br>此功能會備份 Azure Table 中整個弦樂團系統的資料，供系統異常復原或更換 Azure Storage 時移轉使用。</div>${state.systemBackup.error?`<div class="error" style="margin-top:10px">${esc(state.systemBackup.error)}</div>`:""}${exportHtml()}${restoreHtml()}${environmentHtml()}</div>`;
  }
  const baseRender=render;
  render=function(){const r=baseRender();if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountSystemBackup,0);return r};
  if(state.me?.role==="admin"&&state.page==="admin")setTimeout(mountSystemBackup,0);
})();
