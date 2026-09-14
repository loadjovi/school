import { app } from "@azure/functions";
import { verifyGoogleToken } from "../lib/auth.js";

function cookieValue(raw,name){
  for(const part of String(raw||"").split(";")){
    const i=part.indexOf("=");
    if(i<0)continue;
    if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());
  }
  return "";
}
function htmlError(message,status=400){
  return {status,headers:{"Content-Type":"text/html; charset=utf-8"},body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入失敗</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;padding:32px;line-height:1.7"><h2>Google 登入失敗</h2><p>${String(message).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</p><p><a href="/">返回聖心弦樂團登入頁</a></p></body>`};
}

app.http("googleLogin",{
  methods:["POST"],authLevel:"anonymous",route:"google-login",
  handler:async(request)=>{
    const text=await request.text();
    const form=new URLSearchParams(text);
    const credential=String(form.get("credential")||"").trim();
    const formCsrf=String(form.get("g_csrf_token")||"").trim();
    const cookieCsrf=cookieValue(request.headers.get("cookie"),"g_csrf_token");
    if(!credential)return htmlError("Google 未回傳登入憑證。",400);
    if(!formCsrf||!cookieCsrf||formCsrf!==cookieCsrf)return htmlError("登入安全驗證失敗，請返回後重新登入。",400);
    const identity=await verifyGoogleToken(credential);
    if(!identity)return htmlError("Google ID Token 驗證失敗，請確認 GOOGLE_CLIENT_ID 設定。",401);
    return {
      status:302,
      headers:{
        "Location":"/?google_redirect=1",
        "Cache-Control":"no-store",
        "Set-Cookie":`orchestra_google_id_token=${credential}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`
      }
    };
  }
});

app.http("googleLogout",{
  methods:["POST"],authLevel:"anonymous",route:"google-logout",
  handler:async()=>({
    status:204,
    headers:{"Set-Cookie":"orchestra_google_id_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0","Cache-Control":"no-store"}
  })
});
