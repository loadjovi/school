
const state = { me:null, students:[], student:null, page:"home", summary:null, practice:[] };

const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
async function api(url, options={}){
  const res=await fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  if(res.status===401){location.href="/.auth/login/aad";throw new Error("未登入")}
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||data.message||`HTTP ${res.status}`);
  return data;
}
async function boot(){
  try{
    state.me=await api("/api/me");
    state.students=await api("/api/students");
    state.student=state.students[0]||null;
    state.page=state.me.role==="sectionTeacher"?"section":state.me.role==="privateTeacher"?"private":state.me.role==="admin"?"admin":"home";
    if(state.student && state.me.role==="parent") await refreshStudent();
    render();
  }catch(e){document.getElementById("app").innerHTML=`<div class="loading"><div class="error">系統初始化失敗：${esc(e.message)}</div></div>`}
}
async function refreshStudent(){
  if(!state.student)return;
  const month=new Date().toISOString().slice(0,7);
  const [sum,logs]=await Promise.all([
    api(`/api/summary?studentId=${encodeURIComponent(state.student.studentId)}&month=${month}`),
    api(`/api/practice?studentId=${encodeURIComponent(state.student.studentId)}&month=${month}`)
  ]);
  state.summary=sum;state.practice=logs.items||[];
}
function roleText(){return({parent:"家長／學生",sectionTeacher:"分部老師",privateTeacher:"個別課老師",admin:"校方／藝享管理員"}[state.me?.role]||"使用者")}
function shell(content){return `<div class="shell"><header class="top"><div class="brand">🎻 聖心小學弦樂團</div><div class="sub">Azure 外網學習打卡系統 Pilot</div><div class="userrow"><div><small>${esc(state.me.displayName||state.me.email)}</small><span class="role">${roleText()}</span></div><button class="logout" onclick="location.href='/.auth/logout?post_logout_redirect_uri=/'">登出</button></div></header><main class="main">${content}</main>${nav()}</div>`}
function navBtn(page,ico,label){return `<button class="${state.page===page?"active":""}" onclick="go('${page}')"><span>${ico}</span>${label}</button>`}
function nav(){
  const r=state.me.role;
  if(r==="parent")return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","我的紀錄")}${navBtn("help","ℹ️","說明")}</nav>`;
  if(r==="sectionTeacher")return `<nav class="nav">${navBtn("section","🎼","分部點名")}${navBtn("history","🗂️","點名紀錄")}${navBtn("help","ℹ️","說明")}<button></button></nav>`;
  if(r==="privateTeacher")return `<nav class="nav">${navBtn("private","🎻","個別課")}${navBtn("privateHistory","🗂️","上課紀錄")}${navBtn("help","ℹ️","說明")}<button></button></nav>`;
  return `<nav class="nav">${navBtn("admin","📈","Dashboard")}${navBtn("students","👥","學生")}${navBtn("scores","🧮","考核")}${navBtn("help","ℹ️","說明")}</nav>`;
}
async function go(page){state.page=page;if(page==="home"||page==="practice"||page==="record"){if(state.student)await refreshStudent()}render()}
function scoreItem(name,sub,value,cls="ok"){return `<div class="item"><div><b>${esc(name)}</b><small>${esc(sub)}</small></div><span class="badge ${cls}">${esc(value)}</span></div>`}
function home(){
  if(!state.student)return `<div class="card"><div class="notice">尚未綁定學生，請聯絡系統管理員。</div></div>`;
  const s=state.summary||{}; const rate=Math.round((s.practiceRate||0)*1000)/10;
  return `<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div>
  <div class="grid"><div class="kpi"><b>${s.practiceQualifiedDays||0}</b><span>自主練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0}</b><span>累計練習分鐘</span></div><div class="kpi"><b>${s.sectionPresent||0} / ${s.sectionTotal||0}</b><span>分部團練</span></div><div class="kpi"><b>${s.privatePresent||0} / ${s.privateTotal||0}</b><span>個別課</span></div></div>
  <div style="margin-top:12px;font-size:12px;font-weight:800">自主練習達標率 <span style="float:right">${rate}%</span></div><div class="progress"><i style="width:${Math.min(rate,100)}%"></i></div></div>
  <div class="card"><h2>今天要做什麼？</h2><div class="notice">每天自主練習達 <b>15 分鐘以上</b>即列為一個達標日；送出資料會直接寫入 Azure Table Storage。</div><button class="primary" onclick="go('practice')">立即自主練習打卡</button></div>`;
}
function calcMinutes(start,end){if(!start||!end)return 0;const[a,b]=start.split(":").map(Number),[c,d]=end.split(":").map(Number);let m=(c*60+d)-(a*60+b);if(m<0)m+=1440;return m}
function practicePage(){
  const today=new Date().toISOString().slice(0,10); const st=state.student;
  const logs=state.practice.slice(0,8);
  return `<div class="card"><h2>自主練習打卡</h2><div class="notice">登入學生：<b>${esc(st?.name)}</b>｜${esc(st?.groupName)}團｜${esc(st?.instrument)}</div>
  <label>練習日期</label><input id="pDate" type="date" value="${today}">
  <div class="row2"><div><label>開始時間</label><input id="pStart" type="time" value="18:00" oninput="updateMinutes()"></div><div><label>結束時間</label><input id="pEnd" type="time" value="18:20" oninput="updateMinutes()"></div></div>
  <div class="minutes"><div><div class="muted">本次練習時間</div><strong><span id="pMins">20</span> 分鐘</strong></div><span id="pQual" class="badge ok">✅ 已達標</span></div>
  <label>練習內容／曲目</label><textarea id="pContent" rows="3" placeholder="例：G 大調音階、考試曲第 1 段"></textarea>
  <label>練習重點</label><select id="pFocus"><option>音階／基本功</option><option>團練曲目</option><option>考試曲</option><option>節奏／視奏</option><option>其他</option></select>
  <div class="check"><input id="pConfirm" type="checkbox"><div>家長確認：我確認學生已完成上述自主練習，填寫內容與時間屬實。</div></div><button class="primary" onclick="savePractice()">送出今天的打卡</button></div>
  <div class="card"><h2>最近打卡</h2>${logs.length?logs.map(x=>scoreItem(`${x.practiceDate}｜${x.practiceContent||"自主練習"}`,`${x.startTime}～${x.endTime}｜${x.minutes} 分鐘`,x.qualified?"達標":"未達",x.qualified?"ok":"bad")).join(""):`<div class="notice">本月尚無紀錄。</div>`}</div>`;
}
function updateMinutes(){const m=calcMinutes($("pStart").value,$("pEnd").value);$("pMins").textContent=m;$("pQual").className=`badge ${m>=15?"ok":"bad"}`;$("pQual").textContent=m>=15?"✅ 已達標":"⚠️ 未達 15 分鐘"}
async function savePractice(){
  if(!$("pConfirm").checked){toast("請先完成家長確認");return}
  const body={studentId:state.student.studentId,practiceDate:$("pDate").value,startTime:$("pStart").value,endTime:$("pEnd").value,practiceContent:$("pContent").value.trim(),focus:$("pFocus").value,parentConfirmed:true};
  try{await api("/api/practice",{method:"POST",body:JSON.stringify(body)});toast("✅ 自主練習已送出");await refreshStudent();render()}catch(e){toast("❌ "+e.message)}
}
function recordPage(){const s=state.summary||{};return `<div class="card hero"><h2>${esc(state.student?.name)}｜學習紀錄</h2><div class="score">${s.weightedScore??"—"}</div><div class="muted">目前系統統計（考試成績可於後續版本串接）</div></div><div class="card"><h2>本月統計</h2>${scoreItem("自主練習達標","每日 ≥ 15 分鐘",`${s.practiceQualifiedDays||0} 天`)}${scoreItem("自主練習時數","累計",`${Math.floor((s.practiceMinutes||0)/60)} 小時 ${(s.practiceMinutes||0)%60} 分`)}${scoreItem("分部團練","老師確認",`${s.sectionPresent||0} / ${s.sectionTotal||0}`)}${scoreItem("個別課","老師確認",`${s.privatePresent||0} / ${s.privateTotal||0}`)}</div>`}
function sectionPage(){
  const today=new Date().toISOString().slice(0,10);
  return `<div class="card"><h2>分部團練點名</h2><div class="row2"><div><label>上課日期</label><input id="sDate" type="date" value="${today}"></div><div><label>聲部</label><input id="sSection" value="${esc(state.me.section||"")}"></div></div><div class="notice" style="margin-top:10px">只顯示此老師被授權的學生。</div></div><div class="card"><h2>學生名單</h2>${state.students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)}團｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option><option value="cancelled">停課</option></select></div>`).join("")}<button class="primary" onclick="saveSection()">儲存本次點名</button></div>`;
}
async function saveSection(){
  const items=state.students.map(s=>({studentId:s.studentId,status:$(`att_${s.studentId}`).value,minutes:$(`att_${s.studentId}`).value==="absent"?0:45}));
  try{await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("sDate").value,section:$("sSection").value,items})});toast("✅ 分部點名已儲存")}catch(e){toast("❌ "+e.message)}
}
function privatePage(){
  const today=new Date().toISOString().slice(0,10);
  return `<div class="card"><h2>個別課紀錄</h2><label>學生</label><select id="iStudent">${state.students.map(s=>`<option value="${s.studentId}">${esc(s.name)}｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option></select></div><div><label>分鐘</label><input id="iMinutes" type="number" value="50" min="0" max="180"></div></div><label>課程內容</label><textarea id="iContent" rows="3"></textarea><button class="primary" onclick="savePrivate()">儲存個別課紀錄</button></div>`;
}
async function savePrivate(){
  const body={studentId:$("iStudent").value,lessonDate:$("iDate").value,status:$("iStatus").value,minutes:Number($("iMinutes").value||0),lessonContent:$("iContent").value.trim()};
  try{await api("/api/private-lesson",{method:"POST",body:JSON.stringify(body)});toast("✅ 個別課紀錄已儲存")}catch(e){toast("❌ "+e.message)}
}
async function adminPage(){
  return `<div class="card hero"><h2>管理員 Dashboard</h2><div class="grid"><div class="kpi"><b>${state.students.length}</b><span>授權可見學生</span></div><div class="kpi"><b>80%</b><span>考試權重</span></div><div class="kpi"><b>10%</b><span>自主練習</span></div><div class="kpi"><b>5% + 5%</b><span>個別課／分部課</span></div></div></div><div class="card"><h2>學生名單</h2>${state.students.map(s=>scoreItem(`${s.name}｜${s.groupName}團`,`${s.grade}｜${s.instrument}`,"查看","ok")).join("")}</div>`;
}
function helpPage(){return `<div class="card"><h2>系統說明</h2><div class="notice">目前為 Azure Pilot：登入使用 Azure Static Web Apps 驗證；資料由 Azure Functions API 寫入 Azure Table Storage。正式上線前，請完成家長／老師帳號綁定、個資告知、資料保留政策與備份規則。</div></div>`}
function render(){
  const app=$("app"); let content="";
  if(state.page==="home")content=home();
  else if(state.page==="practice")content=practicePage();
  else if(state.page==="record")content=recordPage();
  else if(state.page==="section")content=sectionPage();
  else if(state.page==="private")content=privatePage();
  else if(state.page==="admin"||state.page==="students"||state.page==="scores")content=adminPage();
  else content=helpPage();
  app.innerHTML=shell(content);
}
boot();
