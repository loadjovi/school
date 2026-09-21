(()=>{
  const isAdmin=()=>state.me?.role==="admin";
  state.schoolSchedule=state.schoolSchedule||null;
  state.schedulePreview=state.schedulePreview||null;

  const weekdayText=n=>["週日","週一","週二","週三","週四","週五","週六"][Number(n)]||"";
  const typeText=t=>({section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"}[t]||"課程");
  const escCsv=v=>String(v??"").replaceAll('"','""');

  async function loadSchedule(){state.schoolSchedule=await api("/api/school-schedule")}
  window.openScheduleAdmin=async function(){state.page="schoolSchedule";await loadSchedule();render()};
  window.closeScheduleAdmin=function(){state.page="admin";render()};
  window.activateSchoolSchedule=async function(){
    const count=(state.schoolSchedule?.items||[]).filter(x=>x.status==="active").length;
    if(!count){toast("❌ 請先匯入課表");return}
    if(!confirm(`確定正式啟用目前 ${count} 筆課程規則？\n\n啟用後：\n• 家長首頁依課表顯示今日課程\n• 老師只能在有效上課日點名\n• 已設定停課的日期不可點名`))return;
    try{await api("/api/school-schedule",{method:"PATCH",body:JSON.stringify({action:"activate"})});toast("✅ 課表已正式啟用");state.schedulePreview=null;await loadSchedule();render()}catch(e){toast("❌ "+e.message)}
  };
  window.setScheduleDraft=async function(){
    if(!confirm("切回草稿後，家長首頁將暫停套用此課表，老師點名也不再受課表限制。\n\n確定繼續？"))return;
    try{await api("/api/school-schedule",{method:"PATCH",body:JSON.stringify({action:"draft"})});toast("🟡 已切回草稿");await loadSchedule();render()}catch(e){toast("❌ "+e.message)}
  };
  window.previewScheduleDate=async function(){
    const date=prompt("輸入要預覽的日期（YYYY-MM-DD）",new Date().toLocaleDateString("sv-SE"));if(!date)return;
    try{state.schedulePreview=await api("/api/school-schedule?date="+encodeURIComponent(date)+"&preview=1");render()}catch(e){toast("❌ "+e.message)}
  };
  window.clearSchedulePreview=function(){state.schedulePreview=null;render()};


  function scheduleAdmin(){
    const data=state.schoolSchedule||{items:[],exceptions:[],scheduleState:{status:"draft"}},items=data.items||[],exceptions=data.exceptions||[],scheduleState=data.scheduleState||{status:"draft"};
    const active=items.filter(x=>x.status==="active"),isLive=scheduleState.status==="active",preview=state.schedulePreview;
    const legacyWarning=active.length===14?`<div class="notice" style="margin-top:10px;border:1px solid #f59e0b"><b>⚠️ 偵測到舊版 14 筆課表</b><br>舊版課表可能包含不正確的固定規則。請下載「本校課表範本」確認後，再用「匯入並取代」修正。</div>`:"";
    const statePanel=isLive
      ?`<div class="notice" style="margin-top:12px;border:1px solid #16a34a"><b>🟢 課表已正式啟用</b><br>家長首頁與老師點名都會依此課表執行；非上課日、停課日不可點名。<br><small>啟用時間：${esc(scheduleState.activatedAt||"—")}</small></div><button class="secondary" style="width:100%;margin-top:8px" onclick="setScheduleDraft()">暫停正式課表／切回草稿</button>`
      :`<div class="notice" style="margin-top:12px;border:1px solid #f59e0b"><b>🟡 課表目前為草稿</b><br>可先預覽與核對；尚未套用到家長首頁，也不限制老師點名。確認無誤後再正式啟用。</div><button class="secondary" style="width:100%;margin-top:8px" onclick="previewScheduleDate()">👀 預覽指定日期</button><button class="primary" style="margin-top:8px" onclick="activateSchoolSchedule()">✅ 正式啟用課表</button>`;
    const previewPanel=preview?`<div class="card"><div class="student"><div><h2 style="margin:0">👀 課表預覽｜${esc(preview.date)}</h2><div class="muted">預覽草稿，不影響家長與老師</div></div><button class="secondary" style="width:auto;margin:0;padding:8px 10px" onclick="clearSchedulePreview()">關閉</button></div>${preview.items?.length?preview.items.map(x=>`<div class="item"><div><b>${esc(x.courseName)}</b><small>${esc(x.groupName||"全團")}｜${esc(x.startTime)}–${esc(x.endTime)}${x.location?`｜📍 ${esc(x.location)}`:""}</small></div><span class="badge ${x.effectiveStatus==="cancelled"?"bad":"ok"}">${x.effectiveStatus==="cancelled"?"停課":"上課"}</span></div>`).join(""):'<div class="notice" style="margin-top:10px">此日期沒有排定固定課程。</div>'}</div>`:"";
    return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="closeScheduleAdmin()">← 回管理員 Dashboard</button><div class="student"><div><h2 style="margin:0">📅 課表管理</h2><div class="muted">學校課表統一管理｜家長與老師同步</div></div><span class="badge ok">${active.length} 個課程規則</span></div>
      <div class="notice" style="margin-top:12px">每間學校的課表獨立管理。下載的 CSV 可直接用 Excel 編輯；<b>weekday：1=週一、2=週二、3=週三、4=週四、5=週五、6=週六、0=週日</b>。修改星期、日期與時間後再匯入即可。臨時停課直接按「停課」，家長首頁會同步顯示。</div>
      ${statePanel}
      ${legacyWarning}
      <button class="primary" onclick="downloadSchoolScheduleTemplate()">📥 下載本校課表範本（Excel 可編輯）</button>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="document.getElementById('scheduleCsv').click()">📤 匯入本校課表並取代目前設定</button>
      <input id="scheduleCsv" type="file" accept=".csv,text/csv" style="display:none" onchange="importScheduleCsv(this.files[0])">
    </div>
    ${previewPanel}
    <div class="card"><h2>目前課表</h2>${active.length?active.map(x=>`<div class="item"><div><b>${esc(x.courseName)}</b><small>${esc(typeText(x.courseType))}｜${esc(x.groupName||"全團")}｜${x.recurrence==="weekly"?esc(weekdayText(x.weekday)):esc(x.sessionDate)}｜${esc(x.startTime)}–${esc(x.endTime)}${x.location?`｜📍 ${esc(x.location)}`:""}</small></div><button class="secondary" style="width:auto;margin:0;padding:8px 10px" onclick="cancelSchedulePrompt('${esc(x.scheduleId)}','${esc(x.courseName)}')">停課</button></div>`).join(""):'<div class="notice">尚未建立課表，可先下載「本校課表範本」，用 Excel 編輯後再匯入。</div>'}</div>
    <div class="card"><h2>近期異動</h2>${exceptions.length?exceptions.slice().sort((a,b)=>String(b.sessionDate).localeCompare(String(a.sessionDate))).slice(0,8).map(x=>`<div class="item"><div><b>${esc(x.sessionDate)}｜${x.status==="cancelled"?"停課":"課程異動"}</b><small>${esc(x.reason||"未填原因")}</small></div><span class="badge warn">已通知首頁</span></div>`).join(""):'<div class="notice">目前沒有課程異動。</div>'}</div>`;
  }

  window.cancelSchedulePrompt=async function(scheduleId,name){
    const date=prompt(`${name} 要停課的日期（YYYY-MM-DD）`,new Date().toLocaleDateString("sv-SE"));if(!date)return;
    const reason=prompt("停課原因（家長首頁會顯示）","學校行程調整")||"課程停課";
    try{await api("/api/school-schedule",{method:"PATCH",body:JSON.stringify({action:"exception",scheduleId,sessionDate:date,status:"cancelled",reason})});toast("✅ 已設定停課，家長首頁將同步顯示");await loadSchedule();render()}catch(e){toast("❌ "+e.message)}
  };

  const scheduleHeaders=["courseType","courseName","groupName","recurrence","weekday","startDate","endDate","sessionDate","startTime","endTime","location","note"];
  const requiredScheduleHeaders=["courseType","courseName","groupName","recurrence","weekday","startDate","endDate","sessionDate","startTime","endTime","note"];
  const sacredEnsembleDates=["2026-09-08","2026-09-15","2026-09-22","2026-09-29","2026-10-06","2026-10-13","2026-10-20","2026-10-27","2026-11-03","2026-11-10","2026-11-17","2026-11-24","2026-12-01","2026-12-08","2026-12-15","2026-12-22","2026-12-29"];
  const sacredComprehensiveDates=["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"];

  function sacredHeartTemplate(){
    return [
      ["section","A團分部課","A","weekly","1","2026-09-01","2026-12-31","","17:40","18:30","音樂教室1/2、A／B團練教室區","週一"],
      ["section","A團分部課","A","weekly","3","2026-09-01","2026-12-31","","17:40","18:30","音樂教室1/2、A／B團練教室區","週三"],
      ["section","B團分部課","B","weekly","2","2026-09-01","2026-12-31","","17:40","18:30","音樂教室1/2、A／B團練教室區","週二"],
      ["section","B團分部課","B","weekly","4","2026-09-01","2026-12-31","","17:40","18:30","音樂教室1/2、A／B團練教室區","週四"],
      ["section","儲備團分部課","儲備","weekly","5","2026-10-02","2026-12-31","","17:10","18:30","音樂教室1/2、A／B團練教室區","10/2 起"],
      ...sacredEnsembleDates.map(d=>[
        "ensemble","A、B團合奏課","A,B","date","","","",d,"12:30","13:20",
        "A／B團練教室區","指定日期"
      ]),
      ...sacredComprehensiveDates.map(d=>["comprehensive","弦樂團體活動","A,B,儲備","date","","","",d,"08:45","10:15","音樂教室1/2、A／B團練教室區","固定日期"])
    ];
  }

  function starterTemplate(){
    const school=String(state.me?.schoolName||"");
    if(school.includes("聖心"))return sacredHeartTemplate();
    if(school.includes("忠義")){
      return [
        ["section","A團分部課","A","weekly","2","","","","","","","週二；請補上學期日期、上課時間與地點"],
        ["section","A團分部課","A","weekly","4","","","","","","","週四；請補上學期日期、上課時間與地點"]
      ];
    }
    return [
      ["section","A團分部課","A","weekly","","","","","","","","請填 weekday、學期起訖、時間與地點"],
      ["section","B團分部課","B","weekly","","","","","","","","請填 weekday、學期起訖、時間與地點"],
      ["section","儲備團分部課","儲備","weekly","","","","","","","","不需要的列可刪除"]
    ];
  }

  function exportRowsFromCurrent(){
    const items=(state.schoolSchedule?.items||[]).filter(x=>x.status==="active");
    if(!items.length)return starterTemplate();
    return items.map(x=>[
      x.courseType||"",
      x.courseName||"",
      x.groupName||"",
      x.recurrence||"weekly",
      x.recurrence==="weekly"?String(x.weekday??""):"",
      x.startDate||"",
      x.endDate||"",
      x.recurrence==="date"?(x.sessionDate||""):"",
      x.startTime||"",
      x.endTime||"",
      x.location||"",
      x.note||""
    ]);
  }

  window.downloadSchoolScheduleTemplate=function(){
    const school=String(state.me?.schoolName||"本校").replace(/[\\/:*?"<>|]/g,"_");
    const rows=[scheduleHeaders,...exportRowsFromCurrent()];
    const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${escCsv(v)}"`).join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=school+"_課表匯入範本.csv";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
    toast("✅ 已下載本校課表範本，可用 Excel 編輯");
  };
  function parseCsv(text){const rows=[];let row=[],cell="",quote=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quote&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quote=!quote;else if(ch===","&&!quote){row.push(cell);cell=""}else if((ch==="\n"||ch==="\r")&&!quote){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=""}else cell+=ch}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
  window.importScheduleCsv=async function(file){
    if(!file)return;
    try{
      const rows=parseCsv((await file.text()).replace(/^\uFEFF/,""));
      if(rows.length<2)throw new Error("CSV 沒有課程資料");
      const head=rows[0].map(x=>x.trim());
      const missing=requiredScheduleHeaders.filter(h=>!head.includes(h));
      if(missing.length)throw new Error("CSV 缺少欄位："+missing.join("、"));
      const items=rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]||"").trim()])));
      const normalizeTime=v=>{
        const s=String(v||"").trim();
        const m=s.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
        return m?String(m[1]).padStart(2,"0")+":"+m[2]:"";
      };
      const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
      items.forEach((x,i)=>{
        const row=i+2;
        if(!x.courseType||!x.courseName||!x.groupName)throw new Error(`第 ${row} 列缺少課程類型、名稱或團別`);
        x.startTime=normalizeTime(x.startTime);x.endTime=normalizeTime(x.endTime);
        if(!x.startTime||!x.endTime)throw new Error(`第 ${row} 列上課時間格式不正確，請使用 HH:mm（例如 17:40）`);
        if(x.recurrence==="weekly"){
          const wd=Number(x.weekday);
          if(x.weekday===""||!Number.isInteger(wd)||wd<0||wd>6)throw new Error(`第 ${row} 列 weekday 請填 0–6（1=週一、2=週二…）`);
          x.weekday=wd;
        }else if(x.recurrence==="date"){
          if(!validDate(x.sessionDate))throw new Error(`第 ${row} 列指定日期請填 YYYY-MM-DD`);
          x.weekday=0;
        }else throw new Error(`第 ${row} 列 recurrence 只能是 weekly 或 date`);
      });
      const school=String(state.me?.schoolName||"本校");
      const warning=`準備將「${school}」課表匯入 ${items.length} 筆並取代目前設定。\n\n各學校課表互相獨立；現有課程規則與停課異動會被新版取代。\n\n確認繼續？`;
      if(!confirm(warning))return;
      await api("/api/school-schedule",{method:"POST",body:JSON.stringify({mode:"replace",items})});
      toast(`✅ 已匯入 ${items.length} 筆課表，目前為草稿，請預覽後正式啟用`);
      await loadSchedule();render();
    }catch(e){toast("❌ "+e.message)}
    finally{const i=document.getElementById("scheduleCsv");if(i)i.value=""}
  };

  const baseAdmin=typeof adminPage==="function"?adminPage:null;
  if(baseAdmin)adminPage=function(){const html=baseAdmin();return html.replace("</div>",'</div><div class="card"><h2>📅 課程管理</h2><div class="notice">統一維護固定課表、指定日期課程與臨時停課。</div><button class="primary" onclick="openScheduleAdmin()">開啟課表管理</button></div>')};

  const baseRender=render;
  render=function(){if(isAdmin()&&state.page==="schoolSchedule"){document.getElementById("app").innerHTML=shell(scheduleAdmin());return}return baseRender()};
})();