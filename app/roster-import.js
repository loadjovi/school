(()=>{
  state.rosterPreview=state.rosterPreview||null;
  state.rosterCleanupPreview=state.rosterCleanupPreview||null;
  state.rosterItems=state.rosterItems||[];

  function ensureXlsx(){
    if(window.XLSX)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error("Excel 解析元件載入失敗，請確認網路後重試"));
      document.head.appendChild(s);
    });
  }
  function readArrayBuffer(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("讀取 Excel 檔案失敗"));r.onload=()=>resolve(r.result);r.readAsArrayBuffer(file)})}
  const txt=v=>String(v??"").trim();
  const studentNo=v=>txt(v).replace(/\.0$/,"").replace(/\s+/g,"");
  const semesterName=s=>String(s)==="1"?"上學期":String(s)==="2"?"下學期":"待確認";
  function headerMap(row=[]){const m={};row.forEach((v,i)=>{const k=txt(v).replace(/\s+/g,"");if(k)m[k]=i});return m}
  function value(row,map,names){for(const n of names){const i=map[n];if(i!==undefined)return txt(row[i])}return ""}

  function parseMasterSheet(wb,sheetName){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:false,defval:""});
    if(rows.length<2)return [];
    const h=headerMap(rows[0]),items=[];
    if(h["學號"]===undefined||h["學生姓名"]===undefined&&h["姓名"]===undefined)return [];
    for(let i=1;i<rows.length;i++){
      const r=rows[i]||[],no=studentNo(value(r,h,["學號"])),name=value(r,h,["學生姓名","姓名"]);
      if(!no&&!name)continue;
      const grade=value(r,h,["年級"]),className=value(r,h,["班級"]),classCode=value(r,h,["班級代碼","班級代號"])||`${grade}${className}`;
      items.push({
        schoolYear:value(r,h,["學年度"]),semester:value(r,h,["學期"]),semesterName:value(r,h,["學期名稱"]),enrollmentStatus:value(r,h,["本學期狀態","上課狀態"])||"正式上課",
        studentNo:no,name,grade,className,classCode,seatNo:value(r,h,["座號"]),groupName:value(r,h,["團別"]),section:value(r,h,["分部"]),instrument:value(r,h,["樂器"])
      });
    }
    return items;
  }

  function parseLegacyGroupSheets(wb){
    const groupMap={"A團":"A","B團":"B","儲備團":"儲備","新生團":"儲備"},items=[];
    for(const sheetName of wb.SheetNames){
      const groupName=groupMap[sheetName];if(!groupName)continue;
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:false,defval:""});
      if(!rows.length)continue;
      const h=headerMap(rows[0]);
      if(h["學號"]===undefined)throw new Error(`工作表「${sheetName}」是舊版格式，沒有「學號」欄位。請使用新版學期名單。`);
      for(let i=1;i<rows.length;i++){
        const r=rows[i]||[],no=studentNo(value(r,h,["學號"])),name=value(r,h,["學生姓名","姓名"]);if(!no&&!name)continue;
        const grade=value(r,h,["年級"]),className=value(r,h,["班級"]),classCode=value(r,h,["班級代碼","班級代號"])||`${grade}${className}`;
        items.push({schoolYear:"",semester:"",semesterName:"",enrollmentStatus:"正式上課",studentNo:no,name,grade,className,classCode,seatNo:value(r,h,["座號"]),groupName,section:value(r,h,["分部"]),instrument:value(r,h,["樂器"])});
      }
    }
    return items;
  }

  async function parseExcel(file){
    await ensureXlsx();
    const buf=await readArrayBuffer(file),wb=XLSX.read(buf,{type:"array"});
    let items=[];
    for(const name of ["學生主檔匯入","學生主檔","匯入"]){if(wb.SheetNames.includes(name)){items=parseMasterSheet(wb,name);if(items.length)break}}
    if(!items.length)items=parseLegacyGroupSheets(wb);
    if(!items.length)throw new Error("Excel 中找不到可匯入的學生資料");
    return items;
  }

  function isEnrolled(x){const s=txt(x?.enrollmentStatus||"正式上課");return !["不參加","退團","停用","inactive"].includes(s)&&s!=="待確認"}
  function validStudentNos(){return [...new Set((state.rosterItems||[]).filter(isEnrolled).map(x=>studentNo(x.studentNo)).filter(x=>/^\d{6}$/.test(x)))]}
  function actionLabel(x){return x.action==="create"?"新增":x.action==="update"?"更新":x.action==="migrate"?"轉換學號":"衝突"}
  function actionClass(x){return x.action==="create"?"ok":x.action==="update"||x.action==="migrate"?"warn":"bad"}
  function currentTerm(){const y=String($("rosterYear")?.value||"115").trim(),s=String($("rosterSemester")?.value||"1");return {schoolYear:y,semester:s,semesterName:semesterName(s),label:`${y}學年度第${s}學期（${semesterName(s)}）`}}

  function rosterPanel(){
    if(state.me?.role!=="admin")return "";
    const p=state.rosterPreview,c=state.rosterCleanupPreview;
    const hasWarnings=(p?.warnings||[]).length>0;
    const term=p?.summary?`${esc(p.summary.schoolYear)}學年度第${esc(p.summary.semester)}學期（${esc(p.summary.semesterName)}）`:"本學期";
    const preview=p?`<div class="notice" style="margin-top:12px"><b>${term} 預覽：正式上課 ${p.summary.total} 位</b><br>新增 ${p.summary.create||0} 位、更新 ${p.summary.update||0} 位、舊 ID 轉學號 ${p.summary.migrate||0} 位${p.summary.excluded?`、Excel 標示不參加 ${p.summary.excluded} 位`:""}${p.summary.conflict?`、<b>衝突 ${p.summary.conflict} 位</b>`:""}${p.summary.warnings?`、警告 ${p.summary.warnings} 筆`:""}${c?`。<br>本學期未列入名單：${c.summary.deactivateCurrent||0} 位；舊 SH... 主檔：${c.summary.removeLegacy||0} 筆`:""}。</div>
      <div style="max-height:420px;overflow:auto;margin-top:10px">${(p.items||[]).map(x=>`<div class="item"><div><b>${esc(x.studentNo)}｜${esc(x.name)}</b><small>${esc(x.classCode)}｜${esc(x.grade)}｜${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}${x.oldStudentId?`<br>舊 Student ID：${esc(x.oldStudentId)} → 學號 ${esc(x.studentNo)}`:""}</small></div><span class="badge ${actionClass(x)}">${actionLabel(x)}</span></div>`).join("")}</div>
      ${(p.warnings||[]).length?`<div class="error" style="margin-top:10px"><b>本學期定案前請先修正：</b><br>${p.warnings.map(esc).join("<br>")}</div>`:""}
      ${c?.items?.length?`<details style="margin-top:10px"><summary><b>查看本學期未上課／舊 ID 共 ${c.items.length} 筆</b></summary><div style="max-height:240px;overflow:auto;margin-top:8px">${c.items.map(x=>`<div class="item"><div><b>${esc(x.name||"未命名")}</b><small>${esc(x.studentId)}｜${esc(x.grade)}｜${esc(x.groupName)}團</small></div><span class="badge warn">${esc(x.type)}</span></div>`).join("")}</div></details>`:""}
      ${!p.summary.conflict&&!hasWarnings?`<button class="primary" onclick="applyRosterImport()">確認定案 ${term} 名單</button>`:"<div class='error'>目前不能正式定案：請先處理衝突或警告，再重新預覽。</div>"}`:"";
    return `<div class="card hero"><h2>📥 學期正式上課名單定案</h2><div class="notice"><b>學號是學生唯一值；「是否上課」改以學年度＋學期分開定案。</b><br><br><b>第1學期＝上學期；第2學期＝下學期。</b> 每學期繳費一次，因此每學期都要重新確認正式上課學生。Excel 沒列入該學期的學生只會標示為本學期未上課，<b>不會刪除學號、家長 Gmail 或歷史紀錄</b>。系統另存 SemesterEnrollment，保留每一學期真正上課名單。</div><div class="row2"><div><label>學年度</label><input id="rosterYear" value="115" inputmode="numeric"></div><div><label>學期</label><select id="rosterSemester"><option value="1">1｜上學期</option><option value="2">2｜下學期</option></select></div></div><label>Excel 名單</label><input id="rosterFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><button class="primary" onclick="previewRosterImport()">先預覽本學期定案結果</button>${preview}</div>`;
  }

  window.previewRosterImport=async function(){
    const file=$("rosterFile")?.files?.[0];if(!file){toast("請先選擇 Excel 名單");return}
    try{
      toast("正在解析 Excel…");state.rosterItems=await parseExcel(file);
      const first=state.rosterItems.find(x=>x.schoolYear||x.semester);
      if(first?.schoolYear&&$("rosterYear"))$("rosterYear").value=first.schoolYear;
      if(["1","2"].includes(String(first?.semester||""))&&$("rosterSemester"))$("rosterSemester").value=String(first.semester);
      const t=currentTerm();
      state.rosterPreview=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"preview",schoolYear:t.schoolYear,semester:t.semester,items:state.rosterItems})});
      state.rosterCleanupPreview=await api("/api/student-roster-replace-cleanup",{method:"POST",body:JSON.stringify({action:"preview",schoolYear:t.schoolYear,semester:t.semester,keepStudentNos:validStudentNos()})});
      render();
    }catch(e){state.rosterPreview=null;state.rosterCleanupPreview=null;toast("❌ "+e.message)}
  };

  window.applyRosterImport=async function(){
    if(!state.rosterPreview||!state.rosterItems.length){toast("請先預覽名單");return}
    if((state.rosterPreview.warnings||[]).length||state.rosterPreview.summary?.conflict){toast("請先修正警告／衝突後再定案");return}
    const total=state.rosterPreview.summary?.total||0,t=currentTerm(),notEnrolled=state.rosterCleanupPreview?.summary?.deactivateCurrent||0,legacy=state.rosterCleanupPreview?.summary?.removeLegacy||0;
    if(!confirm(`確定定案「${t.label}」正式上課名單？\n\n正式上課：${total} 位\n本學期未上課：${notEnrolled} 位\n待清理舊 Student ID：${legacy} 筆\n\n未上課學生的學號、家長綁定與歷史資料都會保留。`))return;
    try{
      const d=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"apply",confirmApply:true,schoolYear:t.schoolYear,semester:t.semester,items:state.rosterItems})});
      const cleanup=await api("/api/student-roster-replace-cleanup",{method:"POST",body:JSON.stringify({action:"apply",confirmReplace:true,schoolYear:t.schoolYear,semester:t.semester,keepStudentNos:validStudentNos()})});
      state.rosterPreview=null;state.rosterCleanupPreview=null;state.rosterItems=[];
      toast(`✅ ${t.label} 已定案 ${d.summary?.imported||total} 位；本學期未上課 ${cleanup.summary?.deactivated||0} 位`);await loadAdmin();render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseStudentsPage=studentsPage;
  studentsPage=function(){return rosterPanel()+baseStudentsPage()};
})();
