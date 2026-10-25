import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { listTeacherLogins, validAuditDate } from "../lib/teacherLoginAudit.js";

app.http("teacherLoginHistory",{methods:["GET"],authLevel:"anonymous",route:"teacher-login-history",handler:async request=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  if(context.access.role!=="admin")return json({error:"僅學校管理員可查詢老師登入紀錄"},403);
  const from=String(request.query.get("from")||""),to=String(request.query.get("to")||"");
  if(!validAuditDate(from)||!validAuditDate(to)||from>to)return json({error:"請確認查詢日期起迄"},400);
  const email=String(request.query.get("email")||"").trim().toLowerCase();
  const result=String(request.query.get("result")||""),cursor=String(request.query.get("cursor")||"");
  if(email.length>200||!['','success','denied'].includes(result)||cursor.length>8192)return json({error:"查詢條件不正確"},400);
  try{return json(await listTeacherLogins(context.schoolId,{from,to,email,result,cursor}),200)}
  catch(e){console.error("teacher login history query failed",{schoolId:context.schoolId,error:e?.message||String(e)});return json({error:"登入紀錄暫時無法讀取，請稍後重新查詢"},500)}
}});
