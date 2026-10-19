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
    ("SOP-07", "自主練習與成績", "parent-teacher", "自主練習月報", "每日、月報、學期計分核對"),
]


def generate_sop_lab(app_source: Path, lab_app: Path) -> None:
    """Copy-free navigator; all links navigate to genuine copied Production pages.

    Generate an audit manifest that records sha256 of the ORIGINAL code before
    UAT-only decorations. It contains no student records or credentials.
    """
    original_files = {
        p.relative_to(app_source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(app_source.rglob("*"))
        if p.is_file() and p.suffix.lower() in (".js", ".css", ".html", ".json")
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
button{cursor:pointer;padding:9px 13px;border:1px solid #748ab9;color:#1d315a;border-radius:9px;background:#fff;font:inherit}
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
 <h2>03｜SOP 驗證項目</h2>
 <p>每個情境建議擷取：操作入口、輸入畫面、送出結果、對應角色畫面、CSV（若適用）。僅使用假學生資料。</p>
 <div id="scenarios"></div>
 <div class="row"><button id="export">匯出 SOP 驗收清單 JSON</button><button id="reset">清除本機核對勾選</button></div>
 <p class="muted">核對紀錄僅存於此瀏覽器，不會改動 LAB 或正式資料庫。</p>
</section>
<section class="card">
 <h2>04｜發現畫面不符合需求？</h2>
 <p><strong>請不要單獨修改 SOP LAB 的 HTML。</strong> 從 GitHub 共用的 <code>app/</code> 修正，再部署該修正分支到 SOP LAB 驗證。畫面通過後才合併 <code>main</code>，使正式平台同步修正。</p>
 <p class="notice">提交問題前請移除學生姓名、信箱、Token、金鑰及任何正式資料。</p>
 <a class="link" rel="noopener noreferrer" target="_blank" href="https://github.com/loadjovi/school/issues/new?template=sop-screen-mismatch.yml">🛠️ 提報畫面差異</a>
 <a href="https://github.com/loadjovi/school/actions/workflows/school-functional-uat-lab.yml" target="_blank" rel="noopener noreferrer">重新部署 SOP LAB</a>
</section>
</main>
<script src="./sop.js" defer></script>
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
q("reset").addEventListener("click",()=>{
 if(!confirm("清除這台瀏覽器的 SOP 核對勾選？此操作不會刪除資料庫資料。"))return;
 checks={};localStorage.removeItem(key);display();
});
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
