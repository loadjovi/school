#!/usr/bin/env python3
"""Prepare a production-code-equivalent LAB release with fail-closed data isolation.

Do NOT deploy a PR preview of Production for operational testing; those slots
may share app settings/storage. Output can ONLY be deployed to a separate
Static Web App with a different deployment token and storage account.
"""
from __future__ import annotations
import argparse
import shutil
from pathlib import Path
from sop_lab import generate_sop_lab

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
const attach=()=>{
 if(document.getElementById("functional-uat-banner"))return;
 const badge=document.createElement("div");badge.id="functional-uat-banner";
 badge.setAttribute("role","status");
 badge.style.cssText="position:fixed;z-index:2147483647;right:12px;top:8px;"+
 "font:700 13px/1.35 system-ui,sans-serif;color:#fff;background:#9d4112;"+
 "padding:7px 12px;border-radius:9px;box-shadow:0 3px 11px #0004;pointer-events:none";
 badge.textContent="UAT 功能驗證 LAB｜非正式資料";
 document.body.append(badge);
 fetch("/api/lab-readiness",{cache:"no-store",credentials:"same-origin"})
  .then(res=>res.ok?res.json():Promise.reject(Error("readiness HTTP "+res.status)))
  .then(info=>{if(!info.ready)throw Error("隔離設定未就緒");badge.style.background="#204f89";
                badge.textContent="UAT 功能驗證 LAB｜獨立資料";})
  .catch(()=>{badge.style.background="#a12222";badge.textContent="LAB 隔離狀態未驗證｜請勿操作";});
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",attach,{once:true});
else attach();
})();
'''
def prepare(output: Path) -> None:
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
    email=lib/"email.js"
    text=email.read_text(encoding="utf-8")
    expected='connectionString:clean(process.env.ACS_EMAIL_CONNECTION_STRING,2000),'
    if expected not in text:raise RuntimeError("Email config has changed; review required")
    email.write_text(text.replace(expected,'connectionString:"", // LAB: external email permanently disabled'),
                     encoding="utf-8")
    app=output/"app"
    app.joinpath("functional-lab-banner.js").write_text(BANNER.lstrip(),encoding="utf-8")
    count=0
    for page in app.rglob("*.html"):
        text=page.read_text(encoding="utf-8")
        if "</body>" not in text:continue
        text=text.replace("</body>",'<script defer src="/functional-lab-banner.js"></script></body>')
        text=text.replace("<head>","<head><meta name=\"robots\" content=\"noindex,nofollow\">",1)
        text=text.replace("<title>","<title>【UAT LAB】",1)
        page.write_text(text,encoding="utf-8");count+=1
    if count<3:raise RuntimeError("Unexpected UI layout: missing HTML entrypoints")
    # SOP-only navigator: links to copied Production pages, never duplicates them.
    generate_sop_lab(ROOT/"app",app)
    # No real identities/records or copied secret settings in the release.
    for forbidden in (api/"local.settings.json",app/".env"):
        if forbidden.exists():raise RuntimeError("Unexpected runtime secret file in LAB bundle")
    print(f"Functional LAB prepared: {len(modules)} guarded API modules, {count} labeled HTML pages, isolated output {output}")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=ROOT/".functional-lab-build")
    args=parser.parse_args()
    prepare(args.output)
