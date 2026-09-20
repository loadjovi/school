(()=>{
  const isAdmin=()=>state.me?.role==="admin";
  state.schoolSchedule=state.schoolSchedule||null;

  const weekdayText=n=>["週日","週一","週二","週三","週四","週五","週六"][Number(n)]||"";
  const typeText=t=>({section:"分部課",ensemble:"合奏課",comprehensive:"綜合課"}[t]||"課程");
  const escCsv=v=>String(v??"").replaceAll('"','""');

  async function loadSchedule(){state.schoolSchedule=await api("/api/school-schedule")}
  window.openScheduleAdmin=async function(){state.page="schoolSchedule";await loadSchedule();render()};
  window.closeScheduleAdmin=function(){state.page="admin";render()};

  function scheduleAdmin(){
    const data=state.schoolSchedule||{items:[],exceptions:[]},items=data.items||[],exceptions=data.exceptions||[];
    const active=items.filter(x=>x.status==="active");
    const legacyWarning=active.length===14?`<div class="notice" style="margin-top:10px;border:1px solid #f59e0b"><b>⚠️ 偵測到舊版 14 筆課表</b><br>舊版把 A／B 合奏課設成每週二，會多算未實際上課的日期。請下載新版範本後，用「匯入並取代」修正；新版正確應為 <b>29 筆規則</b>。</div>`:"";
    return `<div class="card hero"><button class="secondary" style="width:auto;margin:0 0 12px;padding:8px 12px" onclick="closeScheduleAdmin()">← 回管理員 Dashboard</button><div class="student"><div><h2 style="margin:0">📅 課表管理</h2><div class="muted">學校課表統一管理｜家長與老師同步</div></div><span class="badge ok">${active.length} 個課程規則</span></div>
      <div class="notice" style="margin-top:12px">平常只需在這裡維護課表。臨時停課直接按「停課」，家長首頁會立即顯示，不列入缺席。</div>
      ${legacyWarning}
      <button class="primary" onclick="downloadSacredHeartScheduleTemplate()">📥 下載新版聖心課表範本（29 筆）</button>
      <button class="secondary" style="width:100%;margin-top:8px" onclick="document.getElementById('scheduleCsv').click()">📤 匯入並取代目前課表 CSV</button>
      <input id="scheduleCsv" type="file" accept=".csv,text/csv" style="display:none" onchange="importScheduleCsv(this.files[0])">
    </div>
    <div class="card"><h2>目前課表</h2>${active.length?active.map(x=>`<div class="item"><div><b>${esc(x.courseName)}</b><small>${esc(typeText(x.courseType))}｜${esc(x.groupName||"全團")}｜${x.recurrence==="weekly"?esc(weekdayText(x.weekday)):esc(x.sessionDate)}｜${esc(x.startTime)}–${esc(x.endTime)}</small></div><button class="secondary" style="width:auto;margin:0;padding:8px 10px" onclick="cancelSchedulePrompt('${esc(x.scheduleId)}','${esc(x.courseName)}')">停課</button></div>`).join(""):'<div class="notice">尚未建立課表，可直接匯入聖心範本。</div>'}</div>
    <div class="card"><h2>近期異動</h2>${exceptions.length?exceptions.slice().sort((a,b)=>String(b.sessionDate).localeCompare(String(a.sessionDate))).slice(0,8).map(x=>`<div class="item"><div><b>${esc(x.sessionDate)}｜${x.status==="cancelled"?"停課":"課程異動"}</b><small>${esc(x.reason||"未填原因")}</small></div><span class="badge warn">已通知首頁</span></div>`).join(""):'<div class="notice">目前沒有課程異動。</div>'}</div>`;
  }

  window.cancelSchedulePrompt=async function(scheduleId,name){
    const date=prompt(`${name} 要停課的日期（YYYY-MM-DD）`,new Date().toLocaleDateString("sv-SE"));if(!date)return;
    const reason=prompt("停課原因（家長首頁會顯示）","學校行程調整")||"課程停課";
    try{await api("/api/school-schedule",{method:"PATCH",body:JSON.stringify({action:"exception",scheduleId,sessionDate:date,status:"cancelled",reason})});toast("✅ 已設定停課，家長首頁將同步顯示");await loadSchedule();render()}catch(e){toast("❌ "+e.message)}
  };

  const ensembleDates=["2026-09-08","2026-09-15","2026-09-22","2026-09-29","2026-10-06","2026-10-13","2026-10-20","2026-10-27","2026-11-03","2026-11-10","2026-11-17","2026-11-24","2026-12-01","2026-12-08","2026-12-15","2026-12-22","2026-12-29"];
  const comprehensiveDates=["2026-09-18","2026-10-02","2026-10-16","2026-10-30","2026-11-20","2026-11-27","2026-12-04"];
  const templateRows=[
    ["courseType","courseName","groupName","recurrence","weekday","startDate","endDate","sessionDate","startTime","endTime","note"],
    ["section","A團分部課","A","weekly","1","2026-09-01","2026-12-31","","17:40","18:30","週一"],
    ["section","A團分部課","A","weekly","3","2026-09-01","2026-12-31","","17:40","18:30","週三"],
    ["section","B團分部課","B","weekly","2","2026-09-01","2026-12-31","","17:40","18:30","週二"],
    ["section","B團分部課","B","weekly","4","2026-09-01","2026-12-31","","17:40","18:30","週四"],
    ["section","儲備團分部課","儲備","weekly","5","2026-10-02","2026-12-31","","17:10","18:30","10/2 起"],
    ...ensembleDates.map(d=>["ensemble","A、B團合奏課","A,B","date","","","",d,"12:30","13:20","指定日期"]),
    ...comprehensiveDates.map(d=>["comprehensive","弦樂團體課（綜合課）","A,B,儲備","date","","","",d,"08:45","10:15","固定日期"])
  ];
  window.downloadSacredHeartScheduleTemplate=function(){
    const csv="\uFEFF"+templateRows.map(r=>r.map(v=>`"${escCsv(v)}"`).join(",")).join("\r\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="聖心小學_課表匯入範本.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)
  };
  function parseCsv(text){const rows=[];let row=[],cell="",quote=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&quote&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quote=!quote;else if(ch===","&&!quote){row.push(cell);cell=""}else if((ch==="\n"||ch==="\r")&&!quote){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=""}else cell+=ch}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
  window.importScheduleCsv=async function(file){
    if(!file)return;
    try{
      const rows=parseCsv((await file.text()).replace(/^\uFEFF/,""));
      if(rows.length<2)throw new Error("CSV 沒有課程資料");
      const head=rows[0].map(x=>x.trim()),items=rows.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]||"").trim()]))).map(x=>({...x,weekday:x.weekday===""?0:Number(x.weekday)}));
      const warning=`準備匯入 ${items.length} 筆課表並「取代目前課表」。\n\n現有課程規則與已設定的停課異動會先清除，再建立新版課表。\n\n確認繼續？`;
      if(!confirm(warning))return;
      await api("/api/school-schedule",{method:"POST",body:JSON.stringify({mode:"replace",items})});
      toast(`✅ 已取代為 ${items.length} 筆課表`);
      await loadSchedule();render();
    }catch(e){toast("❌ "+e.message)}
    finally{const i=document.getElementById("scheduleCsv");if(i)i.value=""}
  };

  const baseAdmin=typeof adminPage==="function"?adminPage:null;
  if(baseAdmin)adminPage=function(){const html=baseAdmin();return html.replace("</div>",'</div><div class="card"><h2>📅 課程管理</h2><div class="notice">統一維護固定課表、指定日期課程與臨時停課。</div><button class="primary" onclick="openScheduleAdmin()">開啟課表管理</button></div>')};

  const baseRender=render;
  render=function(){if(isAdmin()&&state.page==="schoolSchedule"){document.getElementById("app").innerHTML=shell(scheduleAdmin());return}return baseRender()};
})();