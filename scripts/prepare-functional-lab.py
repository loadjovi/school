#!/usr/bin/env python3
"""Prepare a production-code-equivalent LAB release with fail-closed data isolation.

Do NOT deploy a PR preview of Production for operational testing; those slots
may share app settings/storage. Output can ONLY be deployed to a separate
Static Web App with a different deployment token and storage account.
"""
from __future__ import annotations
import argparse
import shutil
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sop_lab import generate_sop_lab
from sop_lab_seed import install as install_sop_fixtures
from sop_lab_parent_bind import install as install_sop_parent_binding
from sop_lab_data_tools import install as install_sop_data_tools

ROOT = Path(__file__).resolve().parents[1]
ISOLATION = r'''
/** Guard every LAB API module before any handler is served. */
export function getLabReadiness() {
 const mode=String(process.env.LAB_ENVIRONMENT||"").trim();
 const expected=String(process.env.LAB_EXPECTED_STORAGE_ACCOUNT||"").trim().toLowerCase();
 const connection=String(process.env.STORAGE_CONNECTION_STRING||"").trim();
 const storage=(connection.split(";").find(s=>/^AccountName=/i.test(s))||"").split("=").slice(1).join("=").trim().toLowerCase();
 const reasons=[];
 if(mode!=="functional-uat")reasons.push("LAB_ENVIRONMENT 必須設定為 functional-uat");
 if(!/^[a-z0-9]{3,24}$/.test(expected)||!/(lab|uat|test)/.test(expected))reasons.push("LAB_EXPECTED_STORAGE_ACCOUNT 必須是獨立的 LAB 儲存帳戶名稱");
 if(!storage||storage!==expected)reasons.push("LAB Storage 連線字串的 AccountName 不符合 LAB 專屬帳戶");
 if(!String(process.env.GOOGLE_CLIENT_ID||"").trim())reasons.push("LAB Google OAuth Client ID 尚未設定");
 return {ready:reasons.length===0,environment:"functional-uat",storageAccount:storage||null,checks:{isolatedStorage:storage===expected&&Boolean(storage),googleConfigured:Boolean(process.env.GOOGLE_CLIENT_ID)},reasons};
}
export function assertLabIsolation() {
 const info=getLabReadiness();
 if(!info.ready)throw new Error("FUNCTIONAL LAB FAIL-CLOSED: "+info.reasons.join("；"));
 return true;
}
'''
READINESS = r'''
import {app} from "@azure/functions";
import {getLabReadiness,assertLabIsolation} from "../lib/labIsolation.mjs";
assertLabIsolation();
app.http("functionalLabReadiness",{methods:["GET"],authLevel:"anonymous",route:"lab-readiness",handler:async()=>({
 status:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
 jsonBody:getLabReadiness()
})});
'''
BANNER = r'''
(()=>{
"use strict";
if(document.getElementById("functional-uat-banner"))return;
const labName="__LAB_NAME__",labPurpose="__LAB_PURPOSE__",labColor="__LAB_COLOR__";
document.title=document.title.replace(/^(?:【UAT LAB】|【新版 LAB】|【舊版 LAB】)/,"");
document.title="【"+labName+"】"+document.title;
const attach=()=>{
 if(document.getElementById("functional-uat-banner"))return;
 // Desktop: reserve the right-hand header area for the account/role selector.
 // Narrow/mobile viewports: put the label in its own flow row BEFORE #app,
 // rather than covering the mobile role switch or logout buttons.
 const style=document.createElement("style");
 style.id="functional-uat-banner-layout";
 style.textContent=`
#functional-uat-banner{
 position:fixed;top:8px;right:clamp(240px,22vw,360px);
 z-index:2147483647;box-sizing:border-box;
 max-width:min(228px,calc(100vw - 24px));
 overflow-wrap:anywhere;
}
@media(max-width:900px){
 #functional-uat-banner{
  position:relative;top:auto;right:auto;
  display:block;width:max-content;
  margin:8px 12px;
  max-width:calc(100% - 24px);
 }
}
.functional-uat-header-label{
 display:block;width:max-content;max-width:100%;box-sizing:border-box;
 padding:2px 7px;margin-top:4px;border-radius:5px;
 background:${labColor};color:#fff;opacity:1;
 font:700 12px/1.5 system-ui,sans-serif;white-space:normal;
 overflow-wrap:anywhere;
}`;
 document.head.append(style);
 const badge=document.createElement("div");badge.id="functional-uat-banner";
 badge.setAttribute("role","status");
 badge.style.cssText="font:700 13px/1.35 system-ui,sans-serif;color:#fff;background:#9d4112;"+
 "padding:7px 12px;border-radius:9px;box-shadow:0 3px 11px #0004;pointer-events:none";
 badge.textContent=labName+"｜"+labPurpose+"｜隔離狀態確認中";
 document.body.insertBefore(badge,document.body.firstChild);
 const labelHeaders=()=>{
  for(const header of document.querySelectorAll("header")){
   if(header.querySelector(".functional-uat-header-label"))continue;
   const label=document.createElement("span");
   label.className="functional-uat-header-label";
   label.textContent=labName+"｜"+labPurpose;
   (header.querySelector(".sub")||header).append(label);
  }
 };
 labelHeaders();
 new MutationObserver(labelHeaders).observe(document.body,{childList:true,subtree:true});
 fetch("/api/lab-readiness",{cache:"no-store",credentials:"same-origin"})
  .then(res=>res.ok?res.json():Promise.reject(Error("readiness HTTP "+res.status)))
  .then(info=>{
    if(!info.ready)throw Error("隔離設定未就緒");
    badge.style.background=labColor;
    badge.textContent=labName+"｜"+labPurpose+"｜獨立資料";
    // Same-tab navigation preserves the main app's sessionStorage Google
    // credential plus the chosen schoolAdmin/tenant context. No token in URLs.
    if(!location.pathname.startsWith("/sop-lab/")){
      const link=document.createElement("a");
      link.href="/sop-lab/";link.textContent="開啟 SOP LAB →";
      link.style.cssText="display:block;color:#fff;font-size:12px;text-decoration:underline;margin-top:3px";
      badge.append(link);badge.style.pointerEvents="auto";
    }
  })
  .catch(()=>{badge.style.background="#a12222";badge.textContent=labName+"｜LAB 隔離狀態未驗證｜請勿操作";});
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attach,{once:true});
else attach();
})();
'''
def prepare(output: Path, *, line_uat: bool = False) -> None:
    output=output.resolve()
    if output==ROOT or ROOT in output.parents and output.name in {"app","api"}:
        raise ValueError("Do not overwrite source directories")
    if output.exists():shutil.rmtree(output)
    output.mkdir(parents=True)
    for directory in ("app","api"):
        shutil.copytree(ROOT/directory,output/directory,
            ignore=shutil.ignore_patterns("node_modules",".env","local.settings.json","__pycache__",".git"))
    api=output/"api"
    lib=api/"src"/"lib"
    lib.joinpath("labIsolation.mjs").write_text(ISOLATION.lstrip(),encoding="utf-8")
    fn_dir=api/"src"/"functions"
    prefix=('import {assertLabIsolation} from "../lib/labIsolation.mjs";\n'
            'assertLabIsolation();\n')
    modules=list(fn_dir.glob("*.js"))
    if len(modules)<10:raise RuntimeError("Unexpected API layout: no functions to guard")
    for file in modules:
        file.write_text(prefix+file.read_text(encoding="utf-8"),encoding="utf-8")
    fn_dir.joinpath("functionalLabReadiness.js").write_text(READINESS.lstrip(),encoding="utf-8")
    # Guard common connection helper too; all direct-storage APIs are additionally
    # blocked by the function module guard above.
    storage=lib/"storage.js"
    original=storage.read_text(encoding="utf-8")
    marker='const conn=()=>process.env.STORAGE_CONNECTION_STRING;'
    if marker not in original:raise RuntimeError("Storage connection structure changed; review required")
    storage.write_text('import {assertLabIsolation} from "./labIsolation.mjs";\n'+
        original.replace(marker,'const conn=()=>{assertLabIsolation();return process.env.STORAGE_CONNECTION_STRING;};'),
        encoding="utf-8")
    # Never deliver emails from tests, even if somebody accidentally configures ACS.
    email=lib/"tenantEmailConfig.mjs"
    text=email.read_text(encoding="utf-8")
    expected='const buildSuppressesExternalEmail = false;'
    if expected not in text:raise RuntimeError("Email config has changed; review required")
    email.write_text(text.replace(expected,'const buildSuppressesExternalEmail = true; // LAB: external email permanently disabled'),
                     encoding="utf-8")
    app=output/"app"
    lab_name="新版 LAB" if line_uat else "舊版 LAB"
    lab_purpose="LINE 整合驗證" if line_uat else "正式功能同步"
    lab_color="#176352" if line_uat else "#284e8c"
    banner=BANNER.replace("__LAB_NAME__",lab_name).replace("__LAB_PURPOSE__",lab_purpose).replace("__LAB_COLOR__",lab_color)
    app.joinpath("functional-lab-banner.js").write_text(banner.lstrip(),encoding="utf-8")
    count=0
    for page in app.rglob("*.html"):
        text=page.read_text(encoding="utf-8")
        if "</body>" not in text:continue
        text=text.replace("</body>",'<script defer src="/functional-lab-banner.js?v=20261119-lab-labels"></script></body>')
        text=text.replace("<head>","<head><meta name=\"robots\" content=\"noindex,nofollow\">",1)
        text=text.replace("<title>",f"<title>【{lab_name}】",1)
        page.write_text(text,encoding="utf-8");count+=1
    if count<3:raise RuntimeError("Unexpected UI layout: missing HTML entrypoints")
    # SOP-only navigator: links to copied Production pages, never duplicates them.
    generate_sop_lab(ROOT/"app",app)
    # Install a read-only diagnostic AFTER copy/branding; this page never exists in Production app/.
    healthcheck_source=ROOT/"scripts"/"lab-performance-healthcheck.html"
    healthcheck_output=app/"sop-lab"/"performance-healthcheck.html"
    healthcheck=healthcheck_source.read_text(encoding="utf-8")
    if "</body>" not in healthcheck or "<meta name=\"robots\" content=\"noindex,nofollow\">" not in healthcheck:
        raise RuntimeError("LAB performance diagnostic must be noindex and have an HTML body")
    healthcheck_output.write_text(healthcheck.replace("</body>",
        '<script defer src="/functional-lab-banner.js?v=20261119-lab-labels"></script></body>'),encoding="utf-8")
    install_sop_fixtures(api)
    install_sop_parent_binding(api)
    install_sop_data_tools(api,app)
    if line_uat:
        config=lib/"lineTenantConfig.js"
        current=config.read_text(encoding="utf-8")
        marker="const buildEnablesDemoFees = false;"
        if marker not in current:raise RuntimeError("DEMO fee flag has changed")
        config.write_text(current.replace(marker,"const buildEnablesDemoFees = true;"),encoding="utf-8")
        shutil.copyfile(ROOT/"scripts"/"line-uat-fee-fixture.js",fn_dir/"lineUatFeeFixture.js")
        fee_page=app/"fee-collections.html"
        fee_page.write_text(fee_page.read_text(encoding="utf-8").replace('<html lang="zh-Hant">','<html lang="zh-Hant" data-line-uat-fees>'),encoding="utf-8")

    # No real identities/records or copied secret settings in the release.
    for forbidden in (api/"local.settings.json",app/".env"):
        if forbidden.exists():raise RuntimeError("Unexpected runtime secret file in LAB bundle")
    print(f"Functional LAB prepared: {len(modules)} guarded API modules, {count} labeled HTML pages, isolated output {output}")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=ROOT/".functional-lab-build")
    parser.add_argument("--line-uat",action="store_true")
    args=parser.parse_args()
    prepare(args.output,line_uat=args.line_uat)
