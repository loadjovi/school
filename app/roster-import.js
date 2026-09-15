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
  function readArrayBuffer(file){
    return new Promise((resolve,reject)=>{
      const r=new FileReader();r.onerror=()=>reject(new Error("讀取 Excel 檔案失敗"));r.onload=()=>resolve(r.result);r.readAsArrayBuffer(file);
    });
  }
  const txt=v=>String(v??"").trim();
  const studentNo=v=>txt(v).replace(/\.0$/,"").replace(/\s+/g,"");
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
        studentNo:no,name,grade,className,classCode,seatNo:value(r,h,["座號"]),semester:value(r,h,["學期"]),
        groupName:value(r,h,["團別"]),section:value(r,h,["分部"]),instrument:value(r,h,["樂器"])
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
      if(h["學號"]===undefined)throw new Error(`工作表「${sheetName}」是舊版格式，沒有「學號」欄位。請使用新版「學號唯一值」匯入檔。`);
      for(let i=1;i<rows.length;i++){
        const r=rows[i]||[],no=studentNo(value(r,h,["學號"])),name=value(r,h,["學生姓名","姓名"]);if(!no&&!name)continue;
        const grade=value(r,h,["年級"]),className=value(r,h,["班級"]),classCode=value(r,h,["班級代碼","班級代號"])||`${grade}${className}`;
        items.push({studentNo:no,name,grade,className,classCode,seatNo:value(r,h,["座號"]),semester:value(r,h,["學期"]),groupName,section:value(r,h,["分部"]),instrument:value(r,h,["樂器"])});
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

  function validStudentNos(){return [...new Set((state.rosterItems||[]).map(x=>studentNo(x.studentNo)).filter(x=>/^\d{6}$/.test(x)))]}
  function actionLabel(x){return x.action==="create"?"新增":x.action==="update"?"更新":x.action==="migrate"?"轉換學號":"衝突"}
  function actionClass(x){return x.action==="create"?"ok":x.action==="update"||x.action==="migrate"?"warn":"bad"}
  function rosterPanel(){
    if(state.me?.role!=="admin")return "";
    const p=state.rosterPreview,c=state.rosterCleanupPreview;
    const hasWarnings=(p?.warnings||[]).length>0;
    const preview=p?`<div class="notice" style="margin-top:12px"><b>預覽結果：可處理 ${p.summary.total} 位</b><br>新增 ${p.summary.create||0} 位、更新 ${p.summary.update||0} 位、舊 ID 轉學號 ${p.summary.migrate||0} 位${p.summary.conflict?`、<b>衝突 ${p.summary.conflict} 位</b>`:""}${p.summary.warnings?`、警告 ${p.summary.warnings} 筆`:""}${c?`、<b>覆蓋時移除舊主檔 ${c.summary.remove||0} 筆</b>`:""}。</div>
      <div style="max-height:420px;overflow:auto;margin-top:10px">${(p.items||[]).map(x=>`<div class="item"><div><b>${esc(x.studentNo)}｜${esc(x.name)}</b><small>${esc(x.classCode)}｜${esc(x.grade)}｜${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}${x.oldStudentId?`<br>舊 Student ID：${esc(x.oldStudentId)} → 學號 ${esc(x.studentNo)}`:""}</small></div><span class="badge ${actionClass(x)}">${actionLabel(x)}</span></div>`).join("")}</div>
      ${(p.warnings||[]).length?`<div class="error" style="margin-top:10px"><b>完整覆蓋前請先修正以下資料：</b><br>${p.warnings.map(esc).join("<br>")}</div>`:""}
      ${c?.items?.length?`<details style="margin-top:10px"><summary><b>將從正式學生主檔移除 ${c.items.length} 筆舊資料</b></summary><div style="max-height:240px;overflow:auto;margin-top:8px">${c.items.map(x=>`<div class="item"><div><b>${esc(x.name||"未命名")}</b><small>${esc(x.studentId)}｜${esc(x.grade)}｜${esc(x.groupName)}團</small></div><span class="badge warn">移除</span></div>`).join("")}</div></details>`:""}
      ${!p.summary.conflict&&!hasWarnings?`<button class="primary" onclick="applyRosterImport()">確認完整覆蓋學生主檔</button>`:"<div class='error'>目前不能正式覆蓋：請先處理衝突或警告，再重新預覽。</div>"}`:"";
    return `<div class="card hero"><h2>📥 Excel 學生主檔匯入／完整覆蓋</h2><div class="notice"><b>新版規則：學號是學生唯一值，Excel 是目前正式學生主檔的完整來源。</b><br><br>上傳並確認後，StudentMaster 會以這份 Excel 為準：Excel 內的學生新增／更新，舊 SH... ID 會先把自主練習、分部課、合奏課、綜合課、個別課與 Gmail 綁定轉到正式學號，再從正式學生主檔移除；<b>Excel 沒有的舊學生主檔也會移除</b>。<br><br>歷史點名、練習與個別課紀錄不會刪除。</div><label>學年度</label><input id="rosterYear" value="115" inputmode="numeric"><label>Excel 名單</label><input id="rosterFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><button class="primary" onclick="previewRosterImport()">先預覽完整覆蓋結果</button>${preview}</div>`;
  }

  window.previewRosterImport=async function(){
    const file=$("rosterFile")?.files?.[0];if(!file){toast("請先選擇 Excel 名單");return}
    try{
      toast("正在解析 Excel…");state.rosterItems=await parseExcel(file);
      const schoolYear=String($("rosterYear")?.value||"115").trim();
      state.rosterPreview=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"preview",schoolYear,items:state.rosterItems})});
      state.rosterCleanupPreview=await api("/api/student-roster-replace-cleanup",{method:"POST",body:JSON.stringify({action:"preview",keepStudentNos:validStudentNos()})});
      render();
    }catch(e){state.rosterPreview=null;state.rosterCleanupPreview=null;toast("❌ "+e.message)}
  };

  window.applyRosterImport=async function(){
    if(!state.rosterPreview||!state.rosterItems.length){toast("請先預覽名單");return}
    if((state.rosterPreview.warnings||[]).length||state.rosterPreview.summary?.conflict){toast("請先修正警告／衝突後再覆蓋");return}
    const total=state.rosterPreview.summary?.total||0,remove=state.rosterCleanupPreview?.summary?.remove||0;
    if(!confirm(`確定以這份 Excel 完整覆蓋學生主檔？\n\n新主檔：${total} 位\n將移除舊主檔：${remove} 筆\n\n歷史練習、出勤與個別課紀錄會保留；可轉換的舊 SH... 資料會先搬到正式學號。`))return;
    try{
      const schoolYear=String($("rosterYear")?.value||"115").trim();
      const d=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"apply",confirmApply:true,schoolYear,items:state.rosterItems})});
      const cleanup=await api("/api/student-roster-replace-cleanup",{method:"POST",body:JSON.stringify({action:"apply",confirmReplace:true,keepStudentNos:validStudentNos()})});
      state.rosterPreview=null;state.rosterCleanupPreview=null;state.rosterItems=[];
      toast(`✅ 已覆蓋 ${d.summary?.imported||total} 位，移除舊主檔 ${cleanup.summary?.removed||0} 筆`);await loadAdmin();render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseStudentsPage=studentsPage;
  studentsPage=function(){return rosterPanel()+baseStudentsPage()};
})();
