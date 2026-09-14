(()=>{
  if(state.me?.role!=="admin")return;
  state.rosterPreview=state.rosterPreview||null;
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
  async function parseExcel(file){
    await ensureXlsx();
    const buf=await readArrayBuffer(file);
    const wb=XLSX.read(buf,{type:"array"});
    const groupMap={"A團":"A","B團":"B","儲備團":"儲備","新生團":"儲備"};
    const items=[];
    for(const sheetName of wb.SheetNames){
      const groupName=groupMap[sheetName];if(!groupName)continue;
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,raw:false,defval:""});
      for(let i=1;i<rows.length;i++){
        const r=rows[i]||[],name=String(r[1]||"").trim();if(!name)continue;
        items.push({groupName,classCode:String(r[0]||"").trim(),name,section:String(r[2]||"").trim(),instrument:String(r[3]||"").trim()});
      }
    }
    if(!items.length)throw new Error("Excel 中找不到 A團、B團或儲備團學生資料");
    return items;
  }

  function rosterPanel(){
    const p=state.rosterPreview;
    const preview=p?`<div class="notice" style="margin-top:12px"><b>預覽結果：共 ${p.summary.total} 位</b><br>預計新增 ${p.summary.create} 位、更新 ${p.summary.update} 位${p.summary.conflict?`、<b>衝突 ${p.summary.conflict} 位</b>`:""}${p.summary.warnings?`、警告 ${p.summary.warnings} 筆`:""}。</div>
      <div style="max-height:380px;overflow:auto;margin-top:10px">${(p.items||[]).map(x=>`<div class="item"><div><b>${esc(x.name)}</b><small>${esc(x.classCode)}｜${esc(x.grade)}｜${esc(x.groupName)}團｜${esc(x.section)}｜${esc(x.instrument)}</small></div><span class="badge ${x.action==="create"?"ok":x.action==="update"?"warn":"bad"}">${x.action==="create"?"新增":x.action==="update"?"更新":"衝突"}</span></div>`).join("")}</div>
      ${(p.warnings||[]).length?`<div class="error" style="margin-top:10px">${p.warnings.map(esc).join("<br>")}</div>`:""}
      ${!p.summary.conflict?`<button class="primary" onclick="applyRosterImport()">確認匯入 ${p.summary.total} 位學生</button>`:"<div class='error'>請先處理同名衝突，再重新預覽。</div>"}`:"";
    return `<div class="card hero"><h2>📥 Excel 學生名單匯入</h2><div class="notice">可直接使用弦樂團 Excel 名單。系統會讀取「A團／B團／儲備團」工作表，自動轉換年級、分部與樂器後寫入 StudentMaster。<br><br><b>安全：</b>Excel 在你的瀏覽器解析，只把學生欄位傳到 Azure 後台，不會存進 GitHub。</div><label>學年度</label><input id="rosterYear" value="115" inputmode="numeric"><label>Excel 名單</label><input id="rosterFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><button class="primary" onclick="previewRosterImport()">先預覽學生名單</button>${preview}</div>`;
  }

  window.previewRosterImport=async function(){
    const file=$("rosterFile")?.files?.[0];if(!file){toast("請先選擇 Excel 名單");return}
    try{
      toast("正在解析 Excel…");
      state.rosterItems=await parseExcel(file);
      const schoolYear=String($("rosterYear")?.value||"115").trim();
      state.rosterPreview=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"preview",schoolYear,items:state.rosterItems})});
      render();
    }catch(e){toast("❌ "+e.message)}
  };

  window.applyRosterImport=async function(){
    if(!state.rosterPreview||!state.rosterItems.length){toast("請先預覽名單");return}
    const total=state.rosterPreview.summary?.total||0;
    if(!confirm(`確定將 ${total} 位學生寫入 StudentMaster？\n\n既有同名學生會更新原資料，不會建立重複 Student ID。`))return;
    try{
      const schoolYear=String($("rosterYear")?.value||"115").trim();
      const d=await api("/api/student-roster-import",{method:"POST",body:JSON.stringify({action:"apply",confirmApply:true,schoolYear,items:state.rosterItems})});
      state.rosterPreview=null;state.rosterItems=[];toast(`✅ 已匯入 ${d.summary?.imported||total} 位學生`);await loadAdmin();render();
    }catch(e){toast("❌ "+e.message)}
  };

  const baseStudentsPage=studentsPage;
  studentsPage=function(){return rosterPanel()+baseStudentsPage()};
})();
