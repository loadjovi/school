"""SOP LAB navigator: uses the exact app/ source tree instead of repainting a simulation."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

SCENARIOS = [
    ("SOP-01", "管理員工作首頁", "school", "工作首頁 → 待辦事項", "待辦與入口、手機與電腦版一致"),
    ("SOP-02", "帳號與學生管理", "school", "帳號管理 → 老師帳號／家長綁定；學生管理", "權限與學生名單正確"),
    ("SOP-03", "團 T 首次領用", "parent-school", "活動與團服 → 團 T", "填尺寸 → 待學校發放 → 學校交付 → 家長確認"),
    ("SOP-04", "A 團比賽服", "parent-school", "活動與團服 → A 團比賽服", "公費／買斷、尺寸、審核及匯出一致"),
    ("SOP-05", "活動設定與報名", "parent-school", "團服與活動 → 活動設定／活動報名", "活動、報名及 CSV 筆數一致"),
    ("SOP-06", "出勤點名與追蹤", "teacher-school", "出勤與請假 → 當日出勤／缺席追蹤", "老師點名與學校待辦連動"),
    ("SOP-07", "自主練習月報", "school-parent", "學校管理員 → 自主練習月報；家長首頁", "每日 20 分鐘達標、月報與家長練習紀錄一致"),
    ("SOP-08", "學期 20 分成績總覽", "school-parent", "學校管理員 → 學期成績總覽；家長首頁 → 10＋5＋5 分", "兩種模式、各月明細、暫估／待評分、手機折疊卡片及 CSV 與家長分數一致"),
    ("SOP-09", "缺席已知悉／待辦結案", "school", "工作首頁 → 學生缺席待追蹤 → 當日行政追蹤名單", "標記已知悉後首頁待辦消失，原缺席、處理人與時間及匯出歷史保留"),
    ("SOP-10", "在團與退團／畢業分流", "school", "學生管理 → 退出／停用；團服與活動 → 團 T → 學生領用紀錄", "僅在團學生列入需求與發放；退出／畢業留歷史且 CSV 分流"),
    ("SOP-11", "舊生團 T 另購", "parent-school", "家長 → 活動與團服 → 團 T → 我要加購團 T（第二件起）", "尺寸、公費資格、NT$400 每件、數量、後台審核及領取進度"),
    ("SOP-12", "團 T 庫存與發放核對", "school-parent", "團服與活動 → 團 T → 庫存管理／學校交付", "分尺寸庫存、交付簽收與家長確認紀錄一致，不將退團生列入當前需求"),
    ("SOP-13", "個課老師與待補資料追蹤", "school", "學期成績總覽 → 個課表現 → 個課老師／資料狀態", "A 團未綁老師仍列入個課模式；已綁無紀錄、老師待完成、家長待確認、改期與評分分流正確"),
]


def generate_sop_lab(app_source: Path, lab_app: Path) -> None:
    """Copy-free navigator; all links navigate to genuine copied Production pages.

    Generate an audit manifest that records sha256 of the ORIGINAL code before
    UAT-only decorations. It contains no student records or credentials.
    """
    original_files = {
        p.relative_to(app_source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(app_source.rglob("*"))
        if p.is_file() and p.suffix.lower() in (".js", ".mjs", ".css", ".html", ".json")
    }
    out_dir = lab_app / "sop-lab"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "source-manifest.json").write_text(
        json.dumps({
            "purpose": "sop-lab",
            "source_repository": "loadjovi/school",
            "source_ref": os.environ.get("GITHUB_REF_NAME", "local-checkout"),
            "source_commit": os.environ.get("GITHUB_SHA", "local-checkout"),
            "source_file_hashes": original_files,
            "isolation": "separate SWA and LAB Storage Account; no real student data",
        }, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    scenario_data = [
        {"id": sid, "title": title, "role": role, "path": path, "expected": expected}
        for sid, title, role, path, expected in SCENARIOS
    ]
    (out_dir / "scenarios.json").write_text(
        json.dumps(scenario_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "index.html").write_text(SOP_HTML, encoding="utf-8")
    (out_dir / "sop.js").write_text(SOP_JS, encoding="utf-8")


SOP_HTML = """<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>【UAT LAB】聖心弦樂成長平台｜SOP 實畫面驗證</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f2f5fa;color:#1d315a;font:16px/1.65 system-ui,"Noto Sans TC",sans-serif}
header{background:#40599b;color:#fff;padding:24px 18px}header h1{font-size:24px;margin:0}header p{margin:4px 0 0}
main{max-width:940px;margin:20px auto;padding:0 16px}
.card{background:#fff;border:1px solid #d8e0ed;border-radius:14px;padding:18px;margin:16px 0}
h2{font-size:19px;margin:0 0 12px}
p{margin:8px 0}small,.muted{color:#5c6d87}
a{color:#3154a0}a.link{display:inline-flex;padding:12px 16px;border-radius:10px;background:#40599b;color:#fff;text-decoration:none;font-weight:700;margin:4px 6px 4px 0}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.check{display:flex;gap:10px;align-items:flex-start;padding:14px 0;border-top:1px solid #e6e9f1}
.check input{height:21px;width:21px;flex:0 0 auto;margin-top:3px}
.check b{display:block}.check small{display:block}
button,select{padding:9px 13px;border:1px solid #748ab9;color:#1d315a;border-radius:9px;background:#fff;font:inherit}button{cursor:pointer}button:disabled{opacity:.55;cursor:default}
.notice{background:#f7f8ee;border-radius:10px;padding:12px;border:1px solid #dddcb8}
.meta{font-family:monospace;overflow-wrap:anywhere;font-size:13px}
@media(max-width:500px){header h1{font-size:20px}.card{padding:13px}}
</style></head>
<body>
<header><h1>🎻 聖心弦樂成長平台｜SOP LAB</h1><p>與正式版共用畫面程式 · 虛構資料 · 獨立測試資料庫</p></header>
<main>
<section class="card">
 <h2>01｜進入正式版相同的操作畫面</h2>
 <p>這裡只是操作導覽；下方按鈕會開啟 LAB 內由 GitHub <code>app/</code> 原始碼產生的真實頁面，不是重畫的 LAB35 模擬介面。</p>
 <div class="row">
  <a class="link" href="/">🏫 完整平台首頁</a>
  <a class="link" href="/parent-uniform-events.html">🎽 家長團服與活動原始頁</a>
  <a class="link" href="/uniform-event-admin.html">📋 團服管理原始頁（檢查用）</a>
 </div>
 <p class="muted">管理員請由「完整平台首頁」登入，再依正式導航進入「團服與活動」。家長、老師要使用 LAB 專屬測試帳號；此工具不會繞過身分驗證。</p>
</section>
<section class="card">
 <h2>02｜環境及版本核對</h2>
 <div id="readiness" class="notice" role="status">正在確認 LAB 資料庫隔離狀態…</div>
 <p class="meta" id="version">正在讀取版本資訊…</p>
 <p class="muted">截圖應記錄本頁顯示的 Commit SHA、測試角色與日期。功能畫面使用的是目前選定 GitHub 分支，而不是另一套獨立 UI。</p>
</section>
<section class="card">
 <h2>03｜清空與還原 LAB 資料</h2>
 <p>重新驗證前，可一鍵清空<strong>目前學校的 LAB 測試資料</strong>。系統會先自動備份；保留學校設定、管理員登入及財務權限、操作稽核。</p>
 <p class="notice">清除包含學生、老師、家長綁定、個課／出勤／評量、課表、團服庫存／申請及活動資料。只限獨立 LAB；操作時請其他幹部暫停使用。清空後可從匯入學生開始，或建立下方完整案例。</p>
 <p id="lab-data-summary" role="status">請先讀取資料範圍。</p>
 <details><summary>查看將清除的資料筆數</summary><div id="lab-data-tables"></div></details>
 <div class="row"><button id="lab-data-refresh" type="button">重新讀取資料範圍</button><button id="lab-data-clear" type="button" disabled>一鍵清空 LAB 測試資料</button><button id="lab-data-restore" type="button" disabled>還原最近清空前備份</button></div>
 <p id="lab-data-backup" class="muted"></p>
 <p id="lab-data-message" role="status" aria-live="polite"></p>
</section>
<section class="card">
 <h2>04｜一鍵建立虛構測試資料</h2>
 <p>僅供 LAB 學校管理員使用。建立 A、B、儲備團 6 位虛構學生，搭配團 T、比賽服、測試活動、課表及個課老師／待補紀錄案例。</p>
 <div class="notice">重複點擊只會跳過已有的測試紀錄，不會覆蓋已修改的申請或領用狀態。必須先由 LAB 學校管理員登入完整平台。</div>
 <p class="muted" id="fixture-session-hint">正在確認這個分頁的學校管理員登入狀態…</p>
 <button id="create-fixtures">建立 SOP 測試資料</button>
 <p id="fixture-message" role="status" aria-live="polite"></p>
 <p class="muted">若你是在另一個分頁登入：請先<a href="/">於此分頁開啟 LAB 完整平台</a>登入並選擇學校管理員，然後點 LAB 右上方新增的「SOP LAB」捷徑返回；不需複製登入憑證。</p>
</section>
<section class="card">
 <h2>05｜將目前帳號綁定為 LAB 測試家長</h2>
 <p>要拍攝家長端警示／團 T 申請進度，必須先用家長身分綁定虛構學生。此功能只會在獨立 LAB 建立<strong>目前登入帳號</strong>與所選假學生的家長關聯，完全不會綁定其他人的 Gmail。</p>
 <div class="notice">重新拍攝首次領用可選「測試己同學（990106，未填尺寸）」；原案例「測試戊同學」的既有紀錄仍會保留。再選「測試甲同學（990101，學校已交付）」驗證家長確認領取。請使用專門的 LAB 測試帳號；即使在獨立 LAB 也不建議和真實家長資料混用。</div>
 <div class="row">
  <select id="lab-parent-student" aria-label="選擇虛構 LAB 學生"><option value="">請先讀取 LAB 學生</option></select>
  <button type="button" id="lab-parent-refresh">讀取測試學生</button>
  <button type="button" id="lab-parent-bind">綁定為測試家長</button>
  <button type="button" id="lab-parent-switch" disabled>切換家長角色查看提醒 →</button>
 </div>
 <p class="muted" role="status" aria-live="polite" id="lab-parent-message">先以 LAB 學校管理員身分登入，讀取六位虛構學生。</p>
</section>
<section class="card">
 <h2>06｜個課異動與待補資料案例</h2>
 <p>個課功能與正式版共用程式。使用虛構學生重現不同進度，讓幹部練習篩選、追蹤與老師綁定。</p>
 <ul><li>測試甲（A）：已綁個課老師、完成評分及家長評論。</li><li>測試乙（A）：已綁個課老師、尚無上課紀錄。</li><li>測試丙（A）：未綁個課老師、尚無上課紀錄；仍應出現在個課表現。</li><li>測試丁（B）：已改期的未來個課。</li><li>測試戊（儲備）：老師已完成、待家長確認。</li><li>測試己（儲備）：課程已過、待老師完成。</li></ul>
 <p class="muted">以上為首次建立時的案例；幹部後續操作會改變進度。示例老師使用不可寄信的虛構帳號，供後台核對；實際老師登入驗證請由管理員設定 LAB 測試帳號。補齊案例不會覆蓋既有修改。</p>
 <button id="lab-private-create" type="button">建立／補齊個課測試案例</button><p id="lab-private-message" role="status" aria-live="polite"></p>
</section>
<section class="card">
 <h2>07｜SOP 驗證項目</h2>
 <p>每個情境建議擷取：操作入口、輸入畫面、送出結果、對應角色畫面、CSV（若適用）。目前檢核包含最新正式版的學期20分、缺席已知悉、團T退團分流與加購。僅使用假學生資料。</p>
 <div id="scenarios"></div>
 <div class="row"><button id="export">匯出 SOP 驗收清單 JSON</button><button id="reset">清除本機核對勾選</button></div>
 <p class="muted">核對紀錄僅存於此瀏覽器，不會改動 LAB 或正式資料庫。</p>
</section>
<section class="card">
 <h2>08｜發現畫面不符合需求？</h2>
 <p><strong>請不要單獨修改 SOP LAB 的 HTML。</strong> 從 GitHub 共用的 <code>app/</code> 修正，再部署該修正分支到 SOP LAB 驗證。畫面通過後才合併 <code>main</code>，使正式平台同步修正。</p>
 <p class="notice">提交問題前請移除學生姓名、信箱、Token、金鑰及任何正式資料。</p>
 <a class="link" rel="noopener noreferrer" target="_blank" href="https://github.com/loadjovi/school/issues/new?template=sop-screen-mismatch.yml">🛠️ 提報畫面差異</a>
 <a href="https://github.com/loadjovi/school/actions/workflows/school-functional-uat-lab.yml" target="_blank" rel="noopener noreferrer">重新部署 SOP LAB</a>
</section>
</main>
<script src="./sop.js" defer></script>
<script src="./data-tools.js" defer></script>
<script defer src="/functional-lab-banner.js"></script>
</body></html>
"""

SOP_JS = r'''
(()=>{
"use strict";
const q=id=>document.getElementById(id),key="school-sop-lab-checks-v1";
function make(tag,txt,cls){
 const n=document.createElement(tag);
 if(txt!==undefined)n.textContent=txt;
 if(cls)n.className=cls;
 return n;
}
let checks={};let scenarios=[];
try{checks=JSON.parse(localStorage.getItem(key)||"{}")}catch{checks={}}
function display(){
 const host=q("scenarios");host.replaceChildren();
 for(const item of scenarios){
  const label=make("label",undefined,"check");
  const input=document.createElement("input");input.type="checkbox";
  input.checked=checks[item.id]===true;input.setAttribute("aria-label",item.id+" "+item.title);
  input.addEventListener("change",()=>{checks[item.id]=input.checked;localStorage.setItem(key,JSON.stringify(checks))});
  const text=document.createElement("span");
  text.append(make("b",item.id+"｜"+item.title),make("small","角色："+item.role+"｜路徑："+item.path),make("small","預期："+item.expected));
  label.append(input,text);host.append(label);
 }
}
Promise.all([
 fetch("/api/lab-readiness",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject(Error("HTTP "+r.status))),
 fetch("./source-manifest.json",{cache:"no-store"}).then(r=>r.json()),
 fetch("./scenarios.json",{cache:"no-store"}).then(r=>r.json())
]).then(([readiness,manifest,data])=>{
 const n=q("readiness");
 n.textContent=readiness.ready?"✅ 已核對：獨立 LAB API／Storage（"+(readiness.storageAccount||"未取得帳戶名")+"）":"⚠️ LAB 隔離未就緒，暫停操作";
 q("version").textContent="GitHub："+manifest.source_repository+"｜分支："+manifest.source_ref+"｜Commit："+manifest.source_commit;
 scenarios=data;display();
}).catch(err=>{
 q("readiness").textContent="⛔ LAB 環境尚未可用（"+err.message+"），禁止對正式資料執行 SOP 測試";
 q("version").textContent="版本尚待確認";fetch("./scenarios.json").then(r=>r.json()).then(data=>{scenarios=data;display()}).catch(()=>{});
});
// The real school app uses per-tab Google ID credentials and role/school context
// in sessionStorage (app-v3.js). Ordinary cookies do not authenticate this API.
// Read them only for the same-origin request. Never expose or persist the token.
function schoolAdminHeaders(){
 const token=sessionStorage.getItem("google_id_token")||"";
 const schoolId=sessionStorage.getItem("school_context_id")||"";
 const role=sessionStorage.getItem("role_context")||"";
 if(!token)throw Error("這個 SOP LAB 分頁尚未登入。請由此分頁進入完整平台登入，再使用「SOP LAB」捷徑返回。");
 if(role!=="schoolAdmin"||!schoolId)throw Error("目前尚未切換學校管理員情境。請在完整平台選擇「學校管理員」後，再使用「SOP LAB」捷徑返回。");
 return {"Content-Type":"application/json","X-Google-ID-Token":token,
         "X-School-Id":schoolId,"X-Role-Context":role};
}
function updateFixtureSessionHint(){
 const hint=q("fixture-session-hint");
 try{
  schoolAdminHeaders();
  hint.textContent="✅ 本分頁具有學校管理員登入資訊，可嘗試建立測試資料（伺服器仍會再次驗證）。";
 }catch(e){hint.textContent="⚠️ "+e.message}
}
updateFixtureSessionHint();
window.addEventListener("pageshow",updateFixtureSessionHint);
q("create-fixtures").addEventListener("click",async()=>{
 const button=q("create-fixtures"),message=q("fixture-message");
 let headers;
 try{headers=schoolAdminHeaders()}catch(error){message.textContent="⚠️ "+error.message;return}
 if(!confirm("確認新增缺少的 6 位虛構學生與團服、比賽服、活動測試資料？空白課表另建立三種草稿課程；已有課表不變更。資料只會新增至目前獨立 LAB 的學校。"))return;
 button.disabled=true;message.textContent="正在確認學校管理員權限…";
 try{
  const check=await fetch("/api/me",{headers,cache:"no-store",credentials:"same-origin"});
  const access=await check.json().catch(()=>({}));
  if(check.status===401)throw Error("登入已失效，請重新登入 LAB 完整平台。");
  if(!check.ok)throw Error(access.error||"管理員權限查詢失敗（HTTP "+check.status+"）");
  if(access.role!=="admin")throw Error("目前不是學校管理員情境，請切換身分後重試。");
  message.textContent="正在建立 LAB 測試資料…";
  const response=await fetch("/api/sop-lab/fixtures",{method:"POST",credentials:"same-origin",
    headers,body:JSON.stringify({confirmation:"CREATE_SOP_FIXTURES"})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"HTTP "+response.status);
  message.textContent="✅ "+data.message+"；新增 "+data.created+" 筆／修補原始 LAB 團 T "+(data.repaired||0)+" 筆／保留既有 "+data.existing+" 筆。請從完整平台首頁重新整理查看。";
  window.dispatchEvent(new Event("lab-fixtures-created"));
 }catch(error){message.textContent="⚠️ "+error.message}
 finally{button.disabled=false}
});
let labParentBindings=[],labBindingSchoolId="";
const bindSelect=q("lab-parent-student");
const parentStatus=q("lab-parent-message");
const parentSwitch=q("lab-parent-switch");
function selectedLabParent(){
 return labParentBindings.find(item=>item.studentId===bindSelect.value);
}
function refreshSwitchState(){
 parentSwitch.disabled=!selectedLabParent()?.bound;
}
async function labParentRequest(method="GET",payload){
 const headers=schoolAdminHeaders();
 const url="/api/sop-lab/parent-binding";
 const response=await fetch(url,{method,credentials:"same-origin",cache:"no-store",headers,
  ...(method==="POST"?{body:JSON.stringify(payload)}:{})});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"LAB 家長綁定失敗（HTTP "+response.status+"）");
 return data;
}
q("lab-parent-refresh").addEventListener("click",async()=>{
 parentStatus.textContent="正在讀取 LAB 虛構學生…";
 const prior=bindSelect.value;
 try{
  const data=await labParentRequest();
  labParentBindings=data.items||[];
  labBindingSchoolId=data.schoolId||"";
  bindSelect.replaceChildren();
  for(const item of labParentBindings){
   const option=document.createElement("option");
   option.value=item.studentId;
   option.textContent=item.name+"（"+item.studentId+"）"+(item.bound?"｜目前帳號已綁定":"");
   option.disabled=!item.available;
   bindSelect.append(option);
  }
  if(labParentBindings.some(x=>x.studentId===prior&&x.available))bindSelect.value=prior;
  else if(labParentBindings.some(x=>x.studentId==="990106"&&x.available))bindSelect.value="990106";
  else if(labParentBindings.some(x=>x.studentId==="990105"&&x.available))bindSelect.value="990105";
  parentStatus.textContent="已取得虛構學生；選擇要測試的情境，綁定後切換家長角色。";
  refreshSwitchState();
 }catch(e){parentStatus.textContent="⚠️ "+e.message;parentSwitch.disabled=true}
});
bindSelect.addEventListener("change",refreshSwitchState);
q("lab-parent-bind").addEventListener("click",async()=>{
 const selected=selectedLabParent();
 if(!selected?.available){parentStatus.textContent="⚠️ 請先讀取並選擇 LAB 虛構學生";return}
 if(!confirm("只在 LAB，將目前登入帳號綁定為「"+selected.name+"」的測試家長？這是模擬關聯，不表示真實親子關係。"))return;
 const button=q("lab-parent-bind");button.disabled=true;
 parentStatus.textContent="正在新增 LAB 測試家長關聯…";
 try{
  const result=await labParentRequest("POST",{studentId:selected.studentId,confirmation:"BIND_MY_LAB_PARENT"});
  selected.bound=true;
  parentStatus.textContent="✅ "+(result.alreadyBound?"此帳號已綁定該虛構學生":"LAB 家長測試關聯已建立")+"。接著可切換家長角色。"+(result.auditSaved===false?"（異動稽核寫入異常，請檢查紀錄）":"");
  refreshSwitchState();
 }catch(e){parentStatus.textContent="⚠️ "+e.message}
 finally{button.disabled=false}
});
parentSwitch.addEventListener("click",async()=>{
 const selected=selectedLabParent();
 if(!selected?.bound){parentStatus.textContent="請先綁定測試學生";return}
 try{
  const data=await labParentRequest();
  const verified=(data.items||[]).find(item=>item.studentId===selected.studentId);
  if(!verified?.bound||!verified.available)throw Error("測試家長關聯尚未生效，請重新讀取後確認");
  const schoolId=data.schoolId||labBindingSchoolId;
  if(!schoolId)throw Error("無法取得 LAB schoolId");
  // Same-tab role switch mirrors selectIdentityContext in the real app.
  sessionStorage.setItem("school_context_id",schoolId);
  sessionStorage.setItem("role_context","parent");
  location.assign("/");
 }catch(e){parentStatus.textContent="⚠️ "+e.message}
});
q("reset").addEventListener("click",()=>{
 if(!confirm("清除這台瀏覽器的 SOP 核對勾選？此操作不會刪除資料庫資料。"))return;
 checks={};localStorage.removeItem(key);display();
});
window.addEventListener("lab-data-reset",()=>{checks={};display()});
q("export").addEventListener("click",()=>{
 const payload=JSON.stringify({
  purpose:"SOP review (not formal UAT certification)",
  recordedAt:new Date().toISOString(),checks,
  selectedIds:scenarios.map(x=>x.id).filter(x=>checks[x]===true),
  cases:scenarios
 },null,2);
 const blob=new Blob([payload],{type:"application/json;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="school-sop-lab-checklist.json";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
});
})();
'''
