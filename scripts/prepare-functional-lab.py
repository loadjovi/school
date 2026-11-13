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
}`;
 document.head.append(style);
 const badge=document.createElement("div");badge.id="functional-uat-banner";
 badge.setAttribute("role","status");
 badge.style.cssText="font:700 13px/1.35 system-ui,sans-serif;color:#fff;background:#9d4112;"+
 "padding:7px 12px;border-radius:9px;box-shadow:0 3px 11px #0004;pointer-events:none";
 badge.textContent="UAT 功能驗證 LAB｜非正式資料";
 document.body.insertBefore(badge,document.body.firstChild);
 fetch("/api/lab-readiness",{cache:"no-store",credentials:"same-origin"})
  .then(res=>res.ok?res.json():Promise.reject(Error("readiness HTTP "+res.status)))
  .then(info=>{
    if(!info.ready)throw Error("隔離設定未就緒");
    badge.style.background="#204f89";
    badge.textContent="UAT 功能驗證 LAB｜獨立資料";
    // Same-tab navigation preserves the main app's sessionStorage Google
    // credential plus the chosen schoolAdmin/tenant context. No token in URLs.
    if(!location.pathname.startsWith("/sop-lab/")){
      const link=document.createElement("a");
      link.href="/sop-lab/";link.textContent="開啟 SOP LAB →";
      link.style.cssText="display:block;color:#fff;font-size:12px;text-decoration:underline;margin-top:3px";
      badge.append(link);badge.style.pointerEvents="auto";
    }
  })
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
    # Shared Production LINE modules must never call the real Messaging API from
    # LAB. The separately generated allowlisted single-recipient endpoint below
    # is the only outbound exception; webhook and shared notification paths stay
    # disabled even when Production secrets accidentally exist in the LAB app.
    line_webhook=fn_dir/"lineWebhook.js"
    webhook_source=line_webhook.read_text(encoding="utf-8")
    secret_expr='const lineSecret=()=>String(process.env.LINE_CHANNEL_SECRET||"").trim();'
    token_expr='const lineToken=()=>String(process.env.LINE_CHANNEL_ACCESS_TOKEN||"").trim();'
    if secret_expr not in webhook_source or token_expr not in webhook_source:
        raise RuntimeError("LINE webhook structure changed; review LAB isolation before deploying")
    line_webhook.write_text(webhook_source.replace(secret_expr,'const lineSecret=()=>""; // LAB: reject real LINE webhook')
        .replace(token_expr,'const lineToken=()=>""; // LAB: no real LINE channel')
        .replace('const url=String(process.env.LINE_OFFICIAL_ACCOUNT_URL||"").trim();',
                 'const url=""; // LAB: never link to the Production LINE account'),encoding="utf-8")
    # LINE Login OAuth and its pure safety rules exist ONLY in the isolated
    # generated LAB API.
    safety_source=(ROOT/"scripts"/"lab-line-notification-safety.mjs").read_text(encoding="utf-8")
    lib.joinpath("labLineNotificationSafety.mjs").write_text(safety_source,encoding="utf-8")
    coverage_model=(ROOT/"scripts"/"lab-line-student-coverage-model.mjs").read_text(encoding="utf-8")
    lib.joinpath("labLineStudentCoverage.mjs").write_text(coverage_model,encoding="utf-8")
    line_auth_rules=(ROOT/"scripts"/"lab-line-auth-rules.mjs").read_text(encoding="utf-8")
    lib.joinpath("labLineAuthRules.mjs").write_text(line_auth_rules,encoding="utf-8")
    line_assertion=(ROOT/"scripts"/"lab-line-api-assertion.mjs").read_text(encoding="utf-8")
    lib.joinpath("labLineApiAssertion.mjs").write_text(line_assertion,encoding="utf-8")
    line_session=(ROOT/"scripts"/"lab-line-session.mjs").read_text(encoding="utf-8")
    lib.joinpath("labLineSession.mjs").write_text(line_session,encoding="utf-8")
    # LAB accepts either Google or a server-side LINE Login session. The LINE
    # identity is parent-only: it can never inherit teacher/admin capabilities,
    # even when the same email has additional platform roles.
    auth=lib/"auth.js"
    auth_source=auth.read_text(encoding="utf-8")
    verify_google='export async function verifyGoogle(request){return verifyGoogleToken(googleToken(request))}'
    google_custom_token='  if(custom&&custom!=="cookie-session")return custom;'
    google_bearer_token='  return auth.slice(7).trim();'
    identity_marker='  const identity=await verifyGoogle(request);\n  if(!identity)return {authenticated:false};\n  const email=identity.email;'
    if verify_google not in auth_source or google_custom_token not in auth_source or google_bearer_token not in auth_source or identity_marker not in auth_source:
        raise RuntimeError("Authentication structure changed; review LAB LINE session integration")
    auth_source='import {getLabLineAssertionIdentity,getLabLineIdentity} from "./labLineSession.mjs";\n'+auth_source
    auth_source=auth_source.replace(google_custom_token,
        '  if(custom&&custom!=="cookie-session"&&!custom.startsWith("line-session.")&&!custom.startsWith("lab-line-assertion."))return custom;',1)
    auth_source=auth_source.replace(google_bearer_token,
        '  const bearer=auth.slice(7).trim();\n  if(bearer.startsWith("line-session.")||bearer.startsWith("lab-line-assertion."))return "";\n  return bearer;',1)
    # Await the Google verifier before evaluating the LINE fallbacks. An
    # unresolved Promise is truthy and would otherwise bypass LINE entirely.
    auth_source=auth_source.replace(verify_google,
        'export async function verifyGoogle(request){return (await verifyGoogleToken(googleToken(request)))||(await getLabLineAssertionIdentity(request))||(await getLabLineIdentity(request))}',1)
    auth_source=auth_source.replace(identity_marker,
        identity_marker+'\n  const lineParentOnly=identity.authProvider==="line";',1)
    auth_source=auth_source.replace('  if(globalRole||schoolRoles.length){',
        '  if(!lineParentOnly&&(globalRole||schoolRoles.length)){',1)
    auth_source=auth_source.replace('  const directory=roleTenantAvailable?await getTeacherDirectory(email,roleSchoolId):null;',
        '  const directory=!lineParentOnly&&roleTenantAvailable?await getTeacherDirectory(email,roleSchoolId):null;',1)
    auth_source=auth_source.replace('  const temporary=roleTenantAvailable&&!directory?await activeTeacherSupport(email,roleSchoolId,supportDay):null;',
        '  const temporary=!lineParentOnly&&roleTenantAvailable&&!directory?await activeTeacherSupport(email,roleSchoolId,supportDay):null;',1)
    if 'const lineParentOnly=identity.authProvider==="line";' not in auth_source:
        raise RuntimeError("LAB LINE parent-only auth insertion failed")
    auth.write_text(auth_source,encoding="utf-8")
    # Preserve provider information for the LAB UI while excluding teacher and
    # administrative contexts from LINE-authenticated sessions.
    me=fn_dir/"me.js"
    me_source=me.read_text(encoding="utf-8")
    tenant_lookup='  let tenantRoles=[];\n  try{tenantRoles=await listTenantRolesByEmail(a.email,"active")}catch(e){console.warn("context tenant role lookup failed",e)}'
    teacher_lookup='    const teacherLookup=(async()=>{\n    try{'
    if tenant_lookup not in me_source or teacher_lookup not in me_source:
        raise RuntimeError("Identity context structure changed; review LAB LINE restrictions")
    me_source=me_source.replace(tenant_lookup,
        '  let tenantRoles=[];\n  if(a.authProvider!=="line")try{tenantRoles=await listTenantRolesByEmail(a.email,"active")}catch(e){console.warn("context tenant role lookup failed",e)}',1)
    me_source=me_source.replace(teacher_lookup,
        '    const teacherLookup=(async()=>{\n    if(a.authProvider==="line")return;\n    try{',1)
    me_source=me_source.replace('  try{await saveUserIdentity(a)}catch(e){console.warn("user identity registry update failed",e)}',
        '  if(a.authProvider!=="line")try{await saveUserIdentity(a)}catch(e){console.warn("user identity registry update failed",e)}',1)
    me_source=me_source.replace('    identityId:a.sub||"",email:a.email,displayName:a.displayName,role:a.role,section:a.section||null,picture:a.picture||null,',
        '    identityId:a.sub||"",email:a.email,displayName:a.displayName,authProvider:a.authProvider||"google",role:a.role,section:a.section||null,picture:a.picture||null,',1)
    if 'authProvider:a.authProvider||"google"' not in me_source:
        raise RuntimeError("LAB identity provider response insertion failed")
    me.write_text(me_source,encoding="utf-8")
    # Reuse the existing student name + six-digit student number comparison and
    # school-admin approval flow. Only after an exact match is the LINE identity
    # registered as this LAB parent's notification identity.
    registration=fn_dir/"studentRegistration.js"
    registration_source=registration.read_text(encoding="utf-8")
    registration_source=registration_source.replace('import { app } from "@azure/functions";',
        'import { app } from "@azure/functions";\nimport {ensureLabLineParentBinding} from "../lib/labLineSession.mjs";',1)
    registration_source=registration_source.replace('registrationId:e.rowKey,parentEmail:e.parentEmail,parentName:e.parentName,relationship:e.relationship,',
        'registrationId:e.rowKey,parentEmail:e.parentEmail,parentName:e.parentName,relationship:e.relationship,authProvider:e.authProvider||"google",',1)
    registration_marker='      const grade=clean(matched.grade,20),groupName=clean(matched.groupName,10),instrument=clean(matched.instrument,20),schoolYear=clean(matched.schoolYear,20);\n      await ensureTenantTables();'
    if registration_marker not in registration_source:
        raise RuntimeError("Student registration match flow changed; review LAB LINE binding")
    registration_source=registration_source.replace(registration_marker,
        '      const grade=clean(matched.grade,20),groupName=clean(matched.groupName,10),instrument=clean(matched.instrument,20),schoolYear=clean(matched.schoolYear,20);\n'
        '      try{await ensureLabLineParentBinding({request,schoolId,parentEmail:access.email})}\n'
        '      catch(error){console.error("LAB LINE parent binding failed",String(error?.name||"Error"));return json({error:"LINE 家長身分綁定失敗，請重新登入後再試"},409)}\n'
        '      await ensureTenantTables();',1)
    registration_source=registration_source.replace('googleSub:access.sub||"",matchedStudentId:',
        'googleSub:access.authProvider==="google"?(access.sub||""):"",identitySub:access.sub||"",authProvider:access.authProvider||"google",matchedStudentId:',1)
    if 'ensureLabLineParentBinding({request,schoolId,parentEmail:access.email})' not in registration_source:
        raise RuntimeError("LAB LINE student registration insertion failed")
    registration.write_text(registration_source,encoding="utf-8")
    oauth_source=(ROOT/"scripts"/"lab-line-login-function.js").read_text(encoding="utf-8")
    fn_dir.joinpath("labLineLogin.js").write_text(prefix+oauth_source,encoding="utf-8")
    coverage_function=(ROOT/"scripts"/"lab-line-student-coverage-function.js").read_text(encoding="utf-8")
    fn_dir.joinpath("labLineStudentCoverage.js").write_text(prefix+coverage_function,encoding="utf-8")
    # The copied Production webhook stays fail-closed in LAB. Parent account
    # linking uses the dedicated OAuth endpoints above and never exposes the
    # legacy six-digit private-chat binding flow.
    fee=output/"app"/"fee-collections.js"
    fee_source=fee.read_text(encoding="utf-8")
    render_start=fee_source.find('function renderLineBinding(){')
    render_end=fee_source.find('\nfunction renderAdminCreate(){',render_start)
    if render_start<0 or render_end<0:raise RuntimeError("LINE frontend render structure changed")
    lab_line_render=r'''function renderLineBinding(){
  if(state.me?.role!=="parent"){$("lineBinding").innerHTML="";return}
  const account=state.line||{},gmailLinked=account.gmailLinked===true,lineLinked=account.lineLinked===true;
  const gmail=gmailLinked?`<span class="badge ok">✅ Gmail 已綁定</span>${account.gmailMasked?`<div class="muted">${esc(account.gmailMasked)}</div>`:""}`:`<span class="badge warn">Gmail 尚未綁定</span>`;
  const line=lineLinked?`<span class="badge ok">✅ LINE 已綁定</span>${account.lineDisplayName?`<div class="muted">${esc(account.lineDisplayName)}</div>`:""}`:`<span class="badge warn">LINE 尚未綁定</span>`;
  if(lineLinked){
    $("lineBinding").innerHTML=`<div class="card"><h2>🔐 LINE／Gmail 雙向綁定已完成</h2><div class="notice">兩種登入方式會進入同一個家長帳號，共用相同的學生與家庭資料。</div><div class="row" style="margin-top:14px"><div class="notice">${gmail}</div><div class="notice">${line}</div></div><p>LINE 私訊可接收弦樂團活動、團 T、期末餐費及匯款核帳等通知。LINE API 接受測試訊息不代表已讀或實際送達。</p><div class="actions"><button class="secondary" data-action="lab-line-test-send">🧪 發送 LINE 單人測試通知</button></div></div>`;return;
  }
  $("lineBinding").innerHTML=`<div class="card"><h2>🔔 追加綁定 LINE</h2><div class="notice">${gmail}</div><div class="steps"><span>1 使用既有 Gmail 家長身分</span><span>2 授權 LINE</span><span>3 自動完成追加綁定</span></div><p>目前的 Gmail 家長帳號與學生關聯會完整保留。直接完成 LINE 授權即可，不需再次輸入學生姓名、學號或額外綁定碼。</p><div class="actions"><button data-action="lab-line-login" style="background:#06c755">追加綁定 LINE</button></div><p class="muted">完成後可使用 Gmail 或 LINE 登入同一個家長帳號；加入官方帳號仍由家長於 LINE 授權畫面確認。</p></div>`;
}'''
    fee_source=fee_source[:render_start]+lab_line_render+fee_source[render_end:]
    parent_load='      const [line,projects]=await Promise.all([api("line/account-binding"),api("fee-collections/projects")]);state.line=line;state.projects=projects.items||[];'
    if parent_load not in fee_source:raise RuntimeError("LINE frontend parent load structure changed")
    lab_parent_load=r'''      const oauthResult=new URLSearchParams(location.search).get("line_lab_result");
      if(oauthResult){
        history.replaceState(null,"",location.pathname);
        if(oauthResult.startsWith("ok.")){
          await api("line/login/finish",{method:"POST",body:JSON.stringify({ticket:oauthResult.slice(3)})});
          state.lineNotice="✅ LINE 已追加綁定至目前 Gmail 家長帳號。";
        }else state.lineNotice="LINE 授權未完成，原 Gmail 與學生資料未變更。";
      }
      const [line,projects]=await Promise.all([api("line/account/status"),api("fee-collections/projects")]);state.line=line;state.projects=projects.items||[];'''
    fee_source=fee_source.replace(parent_load,lab_parent_load,1)
    normal_status='renderLineBinding();renderAdminCreate();renderProjects();showStatus(state.me.role==="admin"?`已載入 ${state.projects.length} 個收費專案。`:state.projects.length?`目前有 ${state.projects.length} 個與您家庭相關的費用項目。`:"目前沒有需要您處理的費用項目。");'
    if normal_status not in fee_source:raise RuntimeError("LINE frontend status structure changed")
    fee_source=fee_source.replace(normal_status,
        'renderLineBinding();renderAdminCreate();renderProjects();showStatus(state.lineNotice||(state.me.role==="admin"?`已載入 ${state.projects.length} 個收費專案。`:state.projects.length?`目前有 ${state.projects.length} 個與您家庭相關的費用項目。`:"目前沒有需要您處理的費用項目。"));',1)
    legacy_actions='''  if(action==="refresh-line-binding")try{showStatus("正在確認 LINE 綁定狀態…");const result=await api("line/account-binding");state.line=result;if(result.bound){state.bindingCode="";renderLineBinding();showStatus("✅ LINE 個人通知已綁定成功。")}else{renderLineBinding();showStatus("尚未收到綁定成功紀錄，請確認已將完整指令傳送至官方帳號的一對一聊天室。","warn")}}catch(error){showStatus(error.message,"error")}
  if(action==="create-line-code")try{showStatus("正在產生一次性綁定碼…");const result=await api("line/account-binding",{method:"POST",body:"{}"});state.bindingCode=result.bindingCode||"";state.line={...(state.line||{}),...result,configured:true};renderLineBinding();showStatus("綁定碼已產生，請在 15 分鐘內私訊 LINE 官方帳號。") }catch(error){showStatus(error.message,"error")}
  if(action==="copy-code"){const command=`#綁定帳號 ${state.bindingCode}`;try{await navigator.clipboard.writeText(command);showStatus("綁定指令已複製。") }catch{showStatus(`請手動複製：${command}`,"warn")}}
  if(action==="unbind-line"&&confirm("確定解除個人 LINE 綁定？之後將不再收到個人核帳通知。"))try{await api("line/account-binding",{method:"DELETE"});state.bindingCode="";state.line={...(state.line||{}),bound:false,lineDisplayName:"",boundAt:""};renderLineBinding();showStatus("已解除個人 LINE 綁定。") }catch(error){showStatus(error.message,"error")}
'''
    if legacy_actions not in fee_source:raise RuntimeError("LINE frontend legacy actions changed")
    lab_actions='''  if(action==="lab-line-login")try{showStatus("正在前往 LINE 授權…");const result=await api("line/login/start",{method:"POST",body:JSON.stringify({returnTo:"fees"})});if(!String(result.authorizationUrl||"").startsWith("https://access.line.me/oauth2/v2.1/authorize?"))throw Error("LINE 授權網址無效");window.location.assign(result.authorizationUrl)}catch(error){showStatus(error.message,"error")}
  if(action==="lab-line-test-send")try{if(!confirm("只發送一則 LAB 測試訊息至指定測試家長的 LINE，是否繼續？"))return;showStatus("正在送出 LAB 測試通知…");const result=await api("line/lab-send-test",{method:"POST",body:"{}"});showStatus(result.message||"LINE 已接受測試訊息，請檢查手機。")}catch(error){showStatus(error.message,"error")}
'''
    fee_source=fee_source.replace(legacy_actions,lab_actions,1)
    for required in ('追加綁定 LINE','LINE／Gmail 雙向綁定已完成','api("line/account/status")','line/login/finish','line/lab-send-test'):
        if required not in fee_source:raise RuntimeError("LAB direct LINE account-link UI insertion failed: "+required)
    for forbidden in ('取得 6 位數綁定碼','create-line-code','copy-code','refresh-line-binding','lab-mock-line-bind'):
        if forbidden in fee_source:raise RuntimeError("LAB legacy LINE binding UI remained: "+forbidden)
    fee.write_text(fee_source,encoding="utf-8")
    # LAB-only masked notification ledger. The endpoint independently requires
    # an authenticated tenant admin; the browser panel removes itself for every
    # other role and is never copied into Production app/.
    log_ui=(ROOT/"scripts"/"lab-line-notification-log.js").read_text(encoding="utf-8")
    (output/"app"/"lab-line-notification-log.js").write_text(log_ui,encoding="utf-8")
    fee_page=output/"app"/"fee-collections.html"
    fee_html=fee_page.read_text(encoding="utf-8")
    admin_marker='<section id="adminCreate"></section>'
    if admin_marker not in fee_html or "</body>" not in fee_html:raise RuntimeError("Fee collection LAB ledger insertion point changed")
    fee_html=fee_html.replace(admin_marker,admin_marker+'<section id="labLineNotificationLog"></section>',1)
    fee_html=fee_html.replace("</body>",'<script type="module" src="/lab-line-notification-log.js"></script></body>',1)
    fee_page.write_text(fee_html,encoding="utf-8")
    messaging=lib/"lineMessaging.mjs"
    messaging_source=messaging.read_text(encoding="utf-8")
    api_guard='async function lineApi(path,{method="POST",body}={}){'
    if api_guard not in messaging_source:
        raise RuntimeError("LINE Messaging API structure changed; review LAB isolation before deploying")
    messaging.write_text(messaging_source.replace(api_guard,
        api_guard+chr(10)+'  throw new Error("LAB LINE external messaging is disabled");'),encoding="utf-8")
    # Never deliver emails from tests, even if somebody accidentally configures ACS.
    email=lib/"email.js"
    text=email.read_text(encoding="utf-8")
    expected='connectionString:clean(process.env.ACS_EMAIL_CONNECTION_STRING,2000),'
    if expected not in text:raise RuntimeError("Email config has changed; review required")
    email.write_text(text.replace(expected,'connectionString:"", // LAB: external email permanently disabled'),
                     encoding="utf-8")
    app=output/"app"
    # Force the LAB shell to request this login fix under a new asset URL. The
    # production source remains unchanged; this only prevents an already-open
    # LAB tab from loading a previous app-v3.js response after deployment.
    webview_guard=app/"webview-guard.js"
    guard_source=webview_guard.read_text(encoding="utf-8")
    guard_app_version='appendScript("/app-v3.js?v=20261102-student-workflow",()=>{'
    if guard_app_version not in guard_source:
        raise RuntimeError("LAB app loader version changed; review LINE login cache isolation")
    webview_guard.write_text(guard_source.replace(guard_app_version,
        'appendScript("/app-v3.js?v=20261113-line-assertion",()=>{',1),encoding="utf-8")
    app_v3=app/"app-v3.js"
    app_source=app_v3.read_text(encoding="utf-8")
    api_token_marker='if(state.token)h["X-Google-ID-Token"]=state.token;'
    if api_token_marker not in app_source:
        raise RuntimeError("Frontend API authentication structure changed; review LAB LINE session integration")
    app_source=app_source.replace(api_token_marker,
        'const token=String(state.token||""),lineHandle=String(sessionStorage.getItem("lab_line_session")||"");if(token.startsWith("lab-line-assertion.")){h["X-Lab-Line-Assertion"]=token;h["X-Google-ID-Token"]=token;h["Authorization"]="Bearer "+token;if(/^[A-Za-z0-9_-]{32,64}$/.test(lineHandle))h["X-Lab-Line-Session"]=lineHandle}else if(token.startsWith("line-session.")){h["X-Lab-Line-Session"]=token.slice(13);h["Authorization"]="Bearer "+token}else if(state.token)h["X-Google-ID-Token"]=state.token;',1)
    app_source=app_source.replace('const r=await fetch(url,fetchOptions);',
        'if(!fetchOptions.credentials)fetchOptions.credentials="same-origin";const r=await fetch(url,fetchOptions);',1)
    boot_marker='async function boot(){if(!state.token){renderLogin();return}try{await loadProfile()}catch(e){renderLogin(e.message)}}'
    if boot_marker not in app_source:
        raise RuntimeError("Frontend boot flow changed; review LAB LINE Login integration")
    app_source=app_source.replace(boot_marker,r'''let labLineBootError="",labLineBootNotice="";
function labLineSessionHeaders(token=state.token){
  const value=String(token||"");
  const saved=String(sessionStorage.getItem("lab_line_session")||"");
  const handle=value.startsWith("line-session.")?value.slice(13):saved;
  return /^[A-Za-z0-9_-]{32,64}$/.test(handle)?{"X-Lab-Line-Session":handle,"Authorization":"Bearer line-session."+handle}:{};
}
async function verifyLabLineSession(token=state.token){
  const response=await fetch("/api/line/auth/session",{cache:"no-store",credentials:"same-origin",headers:labLineSessionHeaders(token)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.authenticated!==true||data.authProvider!=="line"||!isLabLineApiToken(data.apiToken))return false;
  state.token="lab-line-assertion."+data.apiToken;sessionStorage.setItem("google_id_token",state.token);return true;
}
function isLabLineApiToken(value){return /^[A-Za-z0-9_-]{20,800}\.[A-Za-z0-9_-]{43}$/.test(String(value||""))}
async function finishLabLineAccountLink(){
  const query=new URLSearchParams(location.search),result=String(query.get("line_lab_link")||"");
  if(!result)return true;
  query.delete("line_lab_link");history.replaceState(null,"",location.pathname+(query.toString()?"?"+query.toString():"")+location.hash);
  if(!result.startsWith("ok.")){labLineBootError="LINE 綁定授權未完成，原帳號不受影響";return false}
  try{
    await api("/api/line/login/finish",{method:"POST",body:JSON.stringify({ticket:result.slice(3)})});
    labLineBootNotice="✅ LINE 已併入目前家長帳號";return true;
  }catch(error){labLineBootError=error.message||"LINE 綁定失敗";return false}
}
async function restoreLabLineSession(){
  const query=new URLSearchParams(location.search),result=String(query.get("line_lab_auth")||"");
  if(result){
    query.delete("line_lab_auth");history.replaceState(null,"",location.pathname+(query.toString()?"?"+query.toString():"")+location.hash);
    if(!result.startsWith("ok.")){labLineBootError="LINE 授權未完成，請重新操作";return false}
    try{
      const response=await fetch("/api/line/auth/finish",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket:result.slice(3)})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"LINE 登入失敗");
      if(!/^[A-Za-z0-9_-]{32,64}$/.test(String(data.sessionToken||""))||!isLabLineApiToken(data.apiToken))throw Error("LINE 登入憑證未建立，請重新操作");
      sessionStorage.setItem("lab_line_session",data.sessionToken);state.token="lab-line-assertion."+data.apiToken;
      if(!await verifyLabLineSession(state.token))throw Error("LINE 登入狀態未建立，請重新操作");
      sessionStorage.setItem("google_id_token",state.token);return true;
    }catch(error){labLineBootError=error.message||"LINE 登入失敗";return false}
  }
  try{
    if((String(state.token||"").startsWith("line-session.")||String(state.token||"").startsWith("lab-line-assertion."))&&await verifyLabLineSession(state.token)){sessionStorage.setItem("google_id_token",state.token);return true}
    if(await verifyLabLineSession("")){return true}
  }catch{}
  return false;
}
async function boot(){
  if(!await finishLabLineAccountLink()){renderLogin(labLineBootError);return}
  const hasLineAuthResult=new URLSearchParams(location.search).has("line_lab_auth");
  if(hasLineAuthResult){state.token="";sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("lab_line_session")}
  if(hasLineAuthResult||!state.token||state.token==="cookie-session"||String(state.token).startsWith("line-session.")||String(state.token).startsWith("lab-line-assertion.")){
    const restored=await restoreLabLineSession();
    if(!restored){state.token="";sessionStorage.removeItem("google_id_token");renderLogin(labLineBootError);return}
  }
  try{await loadProfile();if(labLineBootNotice)setTimeout(()=>toast(labLineBootNotice),100)}catch(e){renderLogin(e.message)}
}
window.startLabLineAuth=async function(){
  try{
    const response=await fetch("/api/line/auth/start",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"無法啟動 LINE 登入");
    if(!String(data.authorizationUrl||"").startsWith("https://access.line.me/oauth2/v2.1/authorize?"))throw Error("LINE 授權網址無效");
    location.assign(data.authorizationUrl);
  }catch(error){renderLogin(error.message||"無法啟動 LINE 登入")}
};''',1)
    logout_marker='function logout(reload=true){state.token="";state.me=null;state.students=[];state.student=null;sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();if(reload)renderLogin()}'
    if logout_marker not in app_source:
        raise RuntimeError("Frontend logout flow changed; review LAB LINE session cleanup")
    app_source=app_source.replace(logout_marker,
        'function logout(reload=true){const previousToken=String(state.token||""),saved=String(sessionStorage.getItem("lab_line_session")||"");const lineSession=previousToken==="cookie-session"||previousToken.startsWith("line-session.")||previousToken.startsWith("lab-line-assertion.")||Boolean(saved);const handle=previousToken.startsWith("line-session.")?previousToken.slice(13):saved;const lineHeaders=/^[A-Za-z0-9_-]{32,64}$/.test(handle)?{"X-Lab-Line-Session":handle,"Authorization":"Bearer line-session."+handle}:{};state.token="";state.me=null;state.students=[];state.student=null;sessionStorage.removeItem("google_id_token");sessionStorage.removeItem("lab_line_session");sessionStorage.removeItem("school_context_id");sessionStorage.removeItem("role_context");if(lineSession)fetch("/api/line/auth/logout",{method:"POST",credentials:"same-origin",headers:lineHeaders,keepalive:true}).catch(()=>{});if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();if(reload)renderLogin()}',1)
    app_source=app_source.replace('登入已失效，請重新使用 Google 登入','登入已失效，請重新使用 Gmail 或 LINE 登入')
    app_source=app_source.replace('Google Gmail 登入版 v3<br>家長、老師與管理員共用入口',
        '家長可使用 Gmail 或 LINE 登入<br>老師與管理員請使用 Gmail',1)
    google_button='<div id="googleBtn" style="display:flex;justify-content:center;margin-top:18px"></div>'
    if google_button not in app_source:
        raise RuntimeError("Google login button structure changed; review LAB LINE button")
    app_source=app_source.replace(google_button,google_button+'<div class="muted" style="text-align:center;margin:14px 0 8px">或</div><button type="button" class="primary" style="width:100%;background:#06c755" onclick="startLabLineAuth()">使用 LINE 登入（家長）</button>',1)
    app_source=app_source.replace('Google Gmail 登入版 v3</div>',
        '${state.me?.authProvider==="line"?"LINE 登入":"Gmail 登入"}</div>',1)
    app_source=app_source.replace('<br>登入 Gmail：${esc(state.me.email)}<br>',
        '<br>登入方式：${state.me?.authProvider==="line"?`LINE（${esc(state.me.displayName||"家長")}）`:`Gmail（${esc(state.me.email)}）`}<br>',1)
    app_source=app_source.replace('我確認此 Google 帳號為上述學生之家長／監護人，並同意建立家長存取權限。',
        '我確認此${state.me?.authProvider==="line"?" LINE":" Gmail"}帳號為上述學生之家長／監護人，並同意建立家長存取權限。',1)
    app_source=app_source.replace('同一個 Google 帳號可以同時具有 Global、學校管理員、老師與家長身分。',
        '同一個登入帳號可以具有一個或多個已核准身分。',1)
    app_source=app_source.replace('Gmail 只用來辨識家長／老師／管理員；學生資料存在 StudentMaster。',
        'Gmail 或 LINE 只用來辨識登入者；學生資料存在 StudentMaster。',1)
    profile_marker='  if(state.me.role==="admin"){\n    state.page="admin";'
    if profile_marker not in app_source:
        raise RuntimeError("Frontend profile role flow changed; review pending LINE registration state")
    app_source=app_source.replace(profile_marker,
        '  if(state.me.role==="unassigned"){\n'
        '    const pending=await api("/api/student-registration");state.registrations=pending.items||[];\n'
        '    state.students=[];state.student=null;state.page="home";render();return;\n'
        '  }\n'+profile_marker,1)
    registration_form='function registrationForm(){return `<div class="card"><h2>第一次登入｜綁定學生</h2>'
    if registration_form not in app_source:
        raise RuntimeError("Frontend registration form changed; review LINE pending-state UI")
    app_source=app_source.replace(registration_form,
        'function registrationForm(){const pending=(state.registrations||[]).find(x=>x.status==="pending");if(pending)return `<div class="card hero"><h2>學生綁定申請已送出 ✅</h2><div class="notice">${state.me?.authProvider==="line"?"LINE":"Gmail"} 身分已完成驗證；學生 ${esc(pending.studentName||"")}（學號 ${esc(pending.studentNo||"")}）正在等待校方管理員確認。核准前不會開放學生資料。</div></div>`;return `<div class="card"><h2>第一次登入｜綁定學生</h2>',1)
    app_source=app_source.replace('await api("/api/student-registration",{method:"POST",body:JSON.stringify(body)});toast("✅ 已送出，等待管理員確認");state.page="home";render()',
        'await api("/api/student-registration",{method:"POST",body:JSON.stringify(body)});const pending=await api("/api/student-registration");state.registrations=pending.items||[];toast("✅ 已送出，等待管理員確認");state.page="home";render()',1)
    app_source=app_source.replace('申請 Gmail：${esc(r.parentEmail)}<br>家長填寫：',
        '${r.authProvider==="line"?`登入方式：LINE（${esc(r.parentName||"家長")}）`:`申請 Gmail：${esc(r.parentEmail)}`}<br>家長填寫：',1)
    account_marker='\nboot();\n'
    if account_marker not in app_source:
        raise RuntimeError("Frontend boot invocation changed; review LAB account-link panel")
    account_ui=r'''
const labOriginalLoadProfile=loadProfile;
loadProfile=async function(){
  await labOriginalLoadProfile();
  if(!["parent","unassigned"].includes(state.me?.role))return;
  try{state.labAccountLinkStatus=await api("/api/line/account/status")}catch(error){state.labAccountLinkStatus={error:error.message||"無法讀取綁定狀態"}}
  render();
};
function labAccountLinkCard(){
  const status=state.labAccountLinkStatus;
  if(!status)return `<div class="card"><h2>🔐 登入方式</h2><div class="notice">正在確認 Gmail 與 LINE 綁定狀態…</div></div>`;
  if(status.error)return `<div class="card"><h2>🔐 登入方式</h2><div class="error">${esc(status.error)}</div></div>`;
  const gmail=status.gmailLinked?`<span class="badge ok">✅ Gmail 已綁定</span>${status.gmailMasked?`<div class="muted">${esc(status.gmailMasked)}</div>`:""}`:`<span class="badge warn">尚未綁定 Gmail</span>`;
  const line=status.lineLinked?`<span class="badge ok">✅ LINE 已綁定</span>${status.lineDisplayName?`<div class="muted">${esc(status.lineDisplayName)}</div>`:""}`:`<span class="badge warn">尚未綁定 LINE</span>`;
  const action=!status.lineLinked?`<div class="notice" style="margin-top:14px">直接完成 LINE 授權即可，不需再次輸入學生姓名、學號或額外綁定碼。</div><button class="primary" style="background:#06c755" onclick="startLabAccountLineLink()">追加綁定 LINE</button>`:!status.gmailLinked?`<div class="notice" style="margin-top:14px">選擇既有 Gmail 完成追加綁定，不需重新輸入學生姓名與學號。</div><div id="labGmailLinkButton" style="display:flex;justify-content:center;margin-top:14px"></div>`:`<div class="notice" style="margin-top:14px"><b>雙重登入已完成</b><br>之後可使用 Gmail 或 LINE 登入同一個家長帳號。</div>`;
  return `<div class="card"><h2>🔐 登入與通知帳號</h2><div class="notice">增加登入方式不會重複建立家長或學生資料；兩種登入會共用同一組孩子與紀錄。</div><div class="row2" style="margin-top:14px"><div class="item" style="display:block">${gmail}</div><div class="item" style="display:block">${line}</div></div>${action}</div>`;
}
window.startLabAccountLineLink=async function(){
  try{
    const data=await api("/api/line/login/start",{method:"POST",body:JSON.stringify({returnTo:"home"})});
    if(!String(data.authorizationUrl||"").startsWith("https://access.line.me/oauth2/v2.1/authorize?"))throw Error("LINE 授權網址無效");
    location.assign(data.authorizationUrl);
  }catch(error){toast("❌ "+(error.message||"無法啟動 LINE 綁定"))}
};
async function mountLabGmailLinkButton(){
  const target=$("labGmailLinkButton");if(!target||target.dataset.ready==="1")return;
  target.dataset.ready="1";
  try{
    const cfg=await fetch("/api/config",{cache:"no-store"}).then(response=>response.json());
    if(!cfg.googleClientId)throw Error("LAB 尚未設定 Google Client ID");
    for(let count=0;count<100&&!window.google?.accounts?.id;count++)await new Promise(resolve=>setTimeout(resolve,50));
    if(!window.google?.accounts?.id)throw Error("Google 登入元件載入失敗");
    google.accounts.id.initialize({client_id:cfg.googleClientId,callback:async result=>{
      try{
        const linked=await api("/api/line/account/link-google",{method:"POST",body:JSON.stringify({credential:result.credential})});
        toast("✅ Gmail 已併入目前家長帳號");
        state.labAccountLinkStatus={authProvider:"line",gmailLinked:true,gmailMasked:linked.gmailMasked,lineLinked:true,lineDisplayName:state.labAccountLinkStatus?.lineDisplayName||"LINE 家長"};
        await loadProfile();
      }catch(error){toast("❌ "+(error.message||"Gmail 綁定失敗"))}
    }});
    google.accounts.id.renderButton(target,{theme:"outline",size:"large",shape:"pill",text:"continue_with",locale:"zh_TW",width:Math.min(320,Math.max(220,target.clientWidth||280))});
  }catch(error){target.innerHTML=`<div class="error">${esc(error.message||"無法載入 Gmail 綁定")}</div>`}
}
const labOriginalHome=home;
home=function(){const content=labOriginalHome();return ["parent","unassigned"].includes(state.me?.role)?content+labAccountLinkCard():content};
const labOriginalRender=render;
render=function(){labOriginalRender();if($("labGmailLinkButton"))setTimeout(mountLabGmailLinkButton,0)};
'''
    app_source=app_source.replace(account_marker,'\n'+account_ui+account_marker,1)
    if '使用 LINE 登入（家長）' not in app_source or 'line/auth/finish' not in app_source:
        raise RuntimeError("LAB LINE Login frontend insertion failed")
    app_v3.write_text(app_source,encoding="utf-8")
    webview=app/"webview-guard.js"
    webview_source=webview.read_text(encoding="utf-8")
    webview_source=webview_source.replace('  if(embedded){const platform=',
        '  if(embedded&&!isLine){const platform=',1)
    logout_call='try{await fetch("/api/google-logout",{method:"POST"})}catch{}'
    if logout_call not in webview_source:
        raise RuntimeError("Frontend logout flow changed; review LAB LINE session cleanup")
    webview_source=webview_source.replace(logout_call,
        'try{await Promise.allSettled([fetch("/api/google-logout",{method:"POST"}),fetch("/api/line/auth/logout",{method:"POST"})])}catch{}',1)
    webview.write_text(webview_source,encoding="utf-8")
    app.joinpath("functional-lab-banner.js").write_text(BANNER.lstrip(),encoding="utf-8")
    coverage_ui=(ROOT/"scripts"/"lab-line-student-coverage.js").read_text(encoding="utf-8")
    app.joinpath("lab-line-student-coverage.js").write_text(coverage_ui,encoding="utf-8")
    home_page=app/"index.html"
    home_html=home_page.read_text(encoding="utf-8")
    if "</body>" not in home_html:raise RuntimeError("LAB LINE student coverage insertion point changed")
    home_page.write_text(home_html.replace("</body>",'<script defer src="/lab-line-student-coverage.js?v=20261112"></script></body>',1),encoding="utf-8")
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
    # Install a read-only diagnostic AFTER copy/branding; this page never exists in Production app/.
    healthcheck_source=ROOT/"scripts"/"lab-performance-healthcheck.html"
    healthcheck_output=app/"sop-lab"/"performance-healthcheck.html"
    healthcheck=healthcheck_source.read_text(encoding="utf-8")
    if "</body>" not in healthcheck or "<meta name=\"robots\" content=\"noindex,nofollow\">" not in healthcheck:
        raise RuntimeError("LAB performance diagnostic must be noindex and have an HTML body")
    healthcheck_output.write_text(healthcheck.replace("</body>",
        '<script defer src="/functional-lab-banner.js"></script></body>'),encoding="utf-8")
    install_sop_fixtures(api)
    install_sop_parent_binding(api)
    install_sop_data_tools(api,app)
    # No real identities/records or copied secret settings in the release.
    for forbidden in (api/"local.settings.json",app/".env"):
        if forbidden.exists():raise RuntimeError("Unexpected runtime secret file in LAB bundle")
    print(f"Functional LAB prepared: {len(modules)} guarded API modules, {count} labeled HTML pages, isolated output {output}")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=ROOT/".functional-lab-build")
    args=parser.parse_args()
    prepare(args.output)
