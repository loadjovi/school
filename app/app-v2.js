const state={
  me:null,students:[],student:null,page:"home",summary:null,practice:[],
  token:sessionStorage.getItem("google_id_token")||"",
  registrations:[],pendingRegistrations:[]
};

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
function toast(msg){const t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2200)}

async function api(url,options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(state.token)headers["X-Google-ID-Token"]=state.token;
  const r=await fetch(url,{...options,headers});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){logout(false);throw new Error("登入已失效，請重新使用 Google 登入")}
  if(!r.ok)throw new Error(d.error||d.message||`HTTP ${r.status}`);
  return d;
}

function logout(reload=true){
  state.token="";state.me=null;state.students=[];state.student=null;state.registrations=[];
  sessionStorage.removeItem("google_id_token");
  if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();
  if(reload)renderLogin();
}

async function boot(){
  if(!state.token){renderLogin();return}
  try{await loadProfile()}catch(e){renderLogin(e.message)}
}

async function loadProfile(){
  state.me=await api("/api/me");
  state.students=await api("/api/students");
  state.student=state.students[0]||null;
  if(state.me.role==="unassigned"){
    const r=await api("/api/student-registration");
    state.registrations=r.items||[];
    state.page="register";
  }else if(state.me.role==="admin"){
    const r=await api("/api/student-registration?status=pending");
    state.pendingRegistrations=r.items||[];
    state.page="admin";
  }else{
    state.page=state.me.role==="sectionTeacher"?"section":state.me.role==="privateTeacher"?"private":"home";
  }
  if(state.me.role==="parent"&&state.student)await refreshStudent();
  render();
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

async function renderLogin(error=""){
  document.getElementById("app").innerHTML=`
  <div class="login-wrap"><div class="login-card">
    <div class="logo">🎻</div><h1>聖心小學弦樂團</h1>
    <p>Google Gmail 登入版 v2<br>家長、分部老師、個別課老師與管理員共用同一入口</p>
    ${error?`<div class="error">${esc(error)}</div>`:""}
    <div id="googleBtn" style="display:flex;justify-content:center;margin-top:18px"></div>
    <div class="notice" style="margin-top:16px">第一次登入的家長可直接登記學生資料，經管理員確認後即完成 Gmail 與學生綁定。</div>
  </div></div>`;
  try{
    const cfg=await fetch("/api/config").then(r=>r.json());
    if(!cfg.googleClientId){$("googleBtn").innerHTML='<div class="error">尚未設定 GOOGLE_CLIENT_ID</div>';return}
    let n=0;
    const wait=setInterval(()=>{
      n++;
      if(window.google?.accounts?.id){
        clearInterval(wait);
        google.accounts.id.initialize({client_id:cfg.googleClientId,callback:async res=>{
          state.token=res.credential;
          sessionStorage.setItem("google_id_token",state.token);
          try{await loadProfile()}catch(e){renderLogin(e.message)}
        }});
        google.accounts.id.renderButton($("googleBtn"),{theme:"outline",size:"large",shape:"pill",text:"signin_with",locale:"zh_TW",width:280});
      }else if(n>50){clearInterval(wait);$("googleBtn").innerHTML='<div class="error">Google 登入元件載入失敗</div>'}
    },100);
  }catch(e){$("googleBtn").innerHTML=`<div class="error">${esc(e.message)}</div>`}
}

function roleText(){return({parent:"家長／學生",sectionTeacher:"分部老師",privateTeacher:"個別課老師",admin:"校方／藝享管理員",unassigned:"首次登記"}[state.me?.role]||"使用者")}
function shell(content){return `<div class="shell"><header class="top"><div class="brand">🎻 聖心小學弦樂團</div><div class="sub">Google Gmail 登入版 v2</div><div class="userrow"><div><small>${esc(state.me.displayName||state.me.email)}</small><span class="role">${roleText()}</span></div><button class="logout" onclick="logout()">登出</button></div></header><main class="main">${content}</main>${nav()}</div>`}
function navBtn(p,i,l){return `<button class="${state.page===p?"active":""}" onclick="go('${p}')"><span>${i}</span>${l}</button>`}
function nav(){
  const r=state.me.role;
  if(r==="unassigned")return `<nav class="nav">${navBtn("register","📝","學生登記")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;
  if(r==="parent")return `<nav class="nav">${navBtn("home","🏠","首頁")}${navBtn("practice","⏱️","自主打卡")}${navBtn("record","📊","我的紀錄")}${navBtn("help","ℹ️","說明")}</nav>`;
  if(r==="sectionTeacher")return `<nav class="nav">${navBtn("section","🎼","分部點名")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;
  if(r==="privateTeacher")return `<nav class="nav">${navBtn("private","🎻","個別課")}${navBtn("help","ℹ️","說明")}<button></button><button></button></nav>`;
  return `<nav class="nav">${navBtn("admin","📈","Dashboard")}${navBtn("registrations","✅","待審核")}${navBtn("students","👥","學生")}${navBtn("help","ℹ️","說明")}</nav>`;
}

async function go(p){
  state.page=p;
  if(["home","practice","record"].includes(p)&&state.student)await refreshStudent();
  if(p==="registrations"&&state.me.role==="admin"){
    const r=await api("/api/student-registration?status=pending");state.pendingRegistrations=r.items||[];
  }
  render();
}

function scoreItem(n,s,v,c="ok"){return `<div class="item"><div><b>${esc(n)}</b><small>${esc(s)}</small></div><span class="badge ${c}">${esc(v)}</span></div>`}

function registerPage(){
  const pending=state.registrations.filter(x=>x.status==="pending");
  const rejected=state.registrations.filter(x=>x.status==="rejected");
  if(pending.length){
    return `<div class="card hero"><h2>學生資料已送出 ✅</h2><div class="notice">目前等待管理員確認。核准後重新登入，即可開始使用自主練習與學習紀錄。</div>${pending.map(x=>scoreItem(x.studentName,`${x.grade}｜${x.groupName}團｜${x.instrument}`,"待審核","warn")).join("")}</div>`;
  }
  return `<div class="card hero"><h2>第一次登入｜學生資料登記</h2><div class="notice">登入 Gmail：<b>${esc(state.me.email)}</b><br>請填寫孩子目前弦樂團資料。送出後由校方／管理員確認，避免誤綁他人學生資料。</div>
  ${rejected.length?`<div class="error" style="margin-top:10px">先前資料被退回，請確認後重新送出。${rejected[0].note?` 原因：${esc(rejected[0].note)}`:""}</div>`:""}
  <label>家長姓名</label><input id="rParentName" value="${esc(state.me.displayName||"")}" maxlength="40">
  <label>與學生關係</label><select id="rRelationship"><option value="">請選擇</option><option>父親</option><option>母親</option><option>監護人</option><option>其他</option></select>
  <label>學生姓名</label><input id="rStudentName" maxlength="40" placeholder="請輸入學生姓名">
  <div class="row2"><div><label>年級</label><select id="rGrade"><option value="">請選擇</option>${["一年級","二年級","三年級","四年級","五年級","六年級"].map(x=>`<option>${x}</option>`).join("")}</select></div><div><label>目前團別</label><select id="rGroup"><option value="">請選擇</option><option>A</option><option>B</option><option>C</option><option>儲備</option></select></div></div>
  <label>樂器類別</label><select id="rInstrument"><option value="">請選擇</option><option>小提琴</option><option>中提琴</option><option>大提琴</option><option>低音提琴</option><option>其他</option></select>
  <div class="check"><input id="rConsent" type="checkbox"><div>我確認上述資料為本人孩子／受監護學生資料，並同意用於弦樂團學習、出席與考核紀錄。</div></div>
  <button class="primary" onclick="submitRegistration()">送出學生資料</button></div>`;
}

async function submitRegistration(){
  const body={
    parentName:$("rParentName").value.trim(),relationship:$("rRelationship").value,
    studentName:$("rStudentName").value.trim(),grade:$("rGrade").value,
    groupName:$("rGroup").value,instrument:$("rInstrument").value,consent:$("rConsent").checked
  };
  try{
    await api("/api/student-registration",{method:"POST",body:JSON.stringify(body)});
    const r=await api("/api/student-registration");state.registrations=r.items||[];
    toast("✅ 學生資料已送出，等待管理員確認");render();
  }catch(e){toast("❌ "+e.message)}
}

function home(){
  if(!state.student)return `<div class="card"><div class="notice">目前帳號尚未綁定學生。</div></div>`;
  const s=state.summary||{},rate=Math.round((s.practiceRate||0)*1000)/10;
  return `<div class="card hero"><div class="student"><div class="studentleft"><div class="avatar">${esc(state.student.name?.[0]||"學")}</div><div><div class="name">${esc(state.student.name)}</div><div class="muted">${esc(state.student.groupName)}團｜${esc(state.student.instrument)}｜${esc(state.student.grade)}</div></div></div><div class="pill">${new Date().getMonth()+1}月</div></div><div class="grid"><div class="kpi"><b>${s.practiceQualifiedDays||0}</b><span>自主練習達標天數</span></div><div class="kpi"><b>${s.practiceMinutes||0}</b><span>累計練習分鐘</span></div><div class="kpi"><b>${s.sectionPresent||0} / ${s.sectionTotal||0}</b><span>分部團練</span></div><div class="kpi"><b>${s.privatePresent||0} / ${s.privateTotal||0}</b><span>個別課</span></div></div><div style="margin-top:12px;font-size:12px;font-weight:800">自主練習達標率 <span style="float:right">${rate}%</span></div><div class="progress"><i style="width:${Math.min(rate,100)}%"></i></div></div><div class="card"><h2>今天要做什麼？</h2><div class="notice">自主練習達 15 分鐘以上列為達標；資料會寫入 Azure 後台。</div><button class="primary" onclick="go('practice')">立即自主練習打卡</button></div>`;
}

function calcMinutes(s,e){if(!s||!e)return 0;const[a,b]=s.split(":").map(Number),[c,d]=e.split(":").map(Number);let m=(c*60+d)-(a*60+b);if(m<0)m+=1440;return m}
function practicePage(){
  const today=new Date().toISOString().slice(0,10),logs=state.practice.slice(0,8);
  return `<div class="card"><h2>自主練習打卡</h2><div class="notice">${esc(state.student?.name)}｜由 ${esc(state.me.email)} 登入確認</div><label>練習日期</label><input id="pDate" type="date" value="${today}"><div class="row2"><div><label>開始時間</label><input id="pStart" type="time" value="18:00" oninput="updateMinutes()"></div><div><label>結束時間</label><input id="pEnd" type="time" value="18:20" oninput="updateMinutes()"></div></div><div class="minutes"><div><div class="muted">本次練習時間</div><strong><span id="pMins">20</span> 分鐘</strong></div><span id="pQual" class="badge ok">✅ 已達標</span></div><label>練習內容／曲目</label><textarea id="pContent" rows="3"></textarea><label>練習重點</label><select id="pFocus"><option>音階／基本功</option><option>團練曲目</option><option>考試曲</option><option>節奏／視奏</option><option>其他</option></select><div class="check"><input id="pConfirm" type="checkbox"><div>家長確認：我確認學生已完成上述自主練習。</div></div><button class="primary" onclick="savePractice()">送出今天的打卡</button></div><div class="card"><h2>最近打卡</h2>${logs.length?logs.map(x=>scoreItem(`${x.practiceDate}｜${x.practiceContent||"自主練習"}`,`${x.startTime}～${x.endTime}｜${x.minutes} 分鐘`,x.qualified?"達標":"未達",x.qualified?"ok":"bad")).join(""):`<div class="notice">本月尚無紀錄。</div>`}</div>`;
}
function updateMinutes(){const m=calcMinutes($("pStart").value,$("pEnd").value);$("pMins").textContent=m;$("pQual").className=`badge ${m>=15?"ok":"bad"}`;$("pQual").textContent=m>=15?"✅ 已達標":"⚠️ 未達 15 分鐘"}
async function savePractice(){if(!$("pConfirm").checked){toast("請先完成家長確認");return}const body={studentId:state.student.studentId,practiceDate:$("pDate").value,startTime:$("pStart").value,endTime:$("pEnd").value,practiceContent:$("pContent").value.trim(),focus:$("pFocus").value,parentConfirmed:true};try{await api("/api/practice",{method:"POST",body:JSON.stringify(body)});toast("✅ 自主練習已送出");await refreshStudent();render()}catch(e){toast("❌ "+e.message)}}
function recordPage(){const s=state.summary||{};return `<div class="card hero"><h2>${esc(state.student?.name)}｜學習紀錄</h2><div class="score">${s.weightedScore??"—"}</div><div class="muted">目前月統計</div></div><div class="card">${scoreItem("自主練習達標","每日 ≥ 15 分鐘",`${s.practiceQualifiedDays||0} 天`)}${scoreItem("自主練習時數","累計",`${Math.floor((s.practiceMinutes||0)/60)} 小時 ${(s.practiceMinutes||0)%60} 分`)}${scoreItem("分部團練","老師確認",`${s.sectionPresent||0} / ${s.sectionTotal||0}`)}${scoreItem("個別課","老師確認",`${s.privatePresent||0} / ${s.privateTotal||0}`)}</div>`}

function sectionPage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>分部團練點名</h2><label>上課日期</label><input id="sDate" type="date" value="${today}"><label>聲部</label><input id="sSection" value="${esc(state.me.section||"")}"></div><div class="card"><h2>學生名單</h2>${state.students.map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${esc(s.groupName)}團｜${esc(s.instrument)}</small></div><select id="att_${s.studentId}" class="status-select"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option><option value="cancelled">停課</option></select></div>`).join("")}<button class="primary" onclick="saveSection()">儲存本次點名</button></div>`}
async function saveSection(){const items=state.students.map(s=>({studentId:s.studentId,status:$(`att_${s.studentId}`).value,minutes:$(`att_${s.studentId}`).value==="absent"?0:45}));try{await api("/api/section-attendance",{method:"POST",body:JSON.stringify({sessionDate:$("sDate").value,section:$("sSection").value,items})});toast("✅ 分部點名已儲存")}catch(e){toast("❌ "+e.message)}}

function privatePage(){const today=new Date().toISOString().slice(0,10);return `<div class="card"><h2>個別課紀錄</h2><label>學生</label><select id="iStudent">${state.students.map(s=>`<option value="${s.studentId}">${esc(s.name)}｜${esc(s.instrument)}</option>`).join("")}</select><label>上課日期</label><input id="iDate" type="date" value="${today}"><div class="row2"><div><label>狀態</label><select id="iStatus"><option value="present">出席</option><option value="late">遲到</option><option value="leave">請假</option><option value="absent">缺席</option></select></div><div><label>分鐘</label><input id="iMinutes" type="number" value="50"></div></div><label>課程內容</label><textarea id="iContent" rows="3"></textarea><button class="primary" onclick="savePrivate()">儲存個別課紀錄</button></div>`}
async function savePrivate(){try{await api("/api/private-lesson",{method:"POST",body:JSON.stringify({studentId:$("iStudent").value,lessonDate:$("iDate").value,status:$("iStatus").value,minutes:Number($("iMinutes").value||0),lessonContent:$("iContent").value.trim()})});toast("✅ 個別課紀錄已儲存")}catch(e){toast("❌ "+e.message)}}

function registrationsPage(){
  return `<div class="card"><div class="section-title"><h2>待審核學生登記</h2><button class="secondary" onclick="go('registrations')">重新整理</button></div>${state.pendingRegistrations.length?state.pendingRegistrations.map(r=>`<div class="item" style="align-items:flex-start"><div><b>${esc(r.studentName)}</b><small>${esc(r.grade)}｜${esc(r.groupName)}團｜${esc(r.instrument)}<br>${esc(r.parentName)}（${esc(r.relationship)}）<br>${esc(r.parentEmail)}</small></div><div style="display:flex;gap:6px;flex-direction:column"><button class="secondary" onclick="reviewRegistration('${esc(r.registrationId)}','approve')">核准</button><button class="secondary" onclick="reviewRegistration('${esc(r.registrationId)}','reject')">退回</button></div></div>`).join(""):`<div class="notice">目前沒有待審核資料。</div>`}</div>`;
}
async function reviewRegistration(id,action){
  let note="";
  if(action==="reject")note=prompt("可輸入退回原因：")||"";
  if(action==="approve"&&!confirm("確認核准這筆學生資料並綁定家長 Gmail？"))return;
  try{await api("/api/student-registration",{method:"PATCH",body:JSON.stringify({registrationId:id,action,note})});toast(action==="approve"?"✅ 已核准並完成 Gmail 綁定":"已退回");await go("registrations");state.students=await api("/api/students");}catch(e){toast("❌ "+e.message)}
}

function adminPage(){return `<div class="card hero"><h2>管理員 Dashboard</h2><div class="grid"><div class="kpi"><b>${state.students.length}</b><span>目前學生</span></div><div class="kpi"><b>${state.pendingRegistrations.length}</b><span>待審核登記</span></div><div class="kpi"><b>80%</b><span>考試權重</span></div><div class="kpi"><b>10% + 5% + 5%</b><span>練習／個別／分部</span></div></div><button class="primary" onclick="go('registrations')">查看待審核學生</button></div>`}
function studentsPage(){return `<div class="card"><h2>學生資料</h2>${state.students.length?state.students.map(s=>scoreItem(s.name,`${s.grade}｜${s.groupName}團｜${s.instrument}`,s.studentId,"ok")).join(""):`<div class="notice">目前尚無學生。</div>`}</div>`}
function helpPage(){return `<div class="card"><h2>系統說明</h2><div class="notice">家長第一次使用 Google Gmail 登入時，可自行填寫學生姓名、年級、團別與樂器。資料先寫入 Azure 後台並標記待審核；管理員核准後，Gmail 才正式綁定學生並啟用練習與考核紀錄。</div></div>`}

function render(){
  let content="";
  if(state.page==="register")content=registerPage();
  else if(state.page==="home")content=home();
  else if(state.page==="practice")content=practicePage();
  else if(state.page==="record")content=recordPage();
  else if(state.page==="section")content=sectionPage();
  else if(state.page==="private")content=privatePage();
  else if(state.page==="registrations")content=registrationsPage();
  else if(state.page==="students")content=studentsPage();
  else if(state.page==="admin")content=adminPage();
  else content=helpPage();
  document.getElementById("app").innerHTML=shell(content);
}

boot();
