import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {lineAudienceGroups,lineAudienceRoles,lineAudienceStudents,resolveLineAudience} from "../lib/lineAudience.js";
import {workflowLineEnabled,workflowLineRetryKey} from "../lib/lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {lineApi} from "../lib/lineMessaging.mjs";

const list = values => Array.isArray(values)&&values.every(value=>typeof value==="string") ? [...new Set(values)].sort() : null;
const fail=(error,status=400)=>json({error},status);

app.http("lineAnnouncements",{
  methods:["GET","POST"],authLevel:"anonymous",route:"line/announcements",
  handler:async request=>{
    const ctx=await getTenantContext(request);
    if(ctx.error)return ctx.error;
    const {schoolId,access}=ctx;
    if(access.role!=="admin")return fail("僅學校管理員可發佈通知",403);
    try{
      const channel=await resolveTenantLineChannel(schoolId);
      if(!channel.loginConfigured||!workflowLineEnabled())return fail("此環境尚未啟用 LINE 公告",409);
      const students=await lineAudienceStudents(schoolId),options=lineAudienceGroups(students);
      if(request.method==="GET")return json({groups:options});
      if(request.headers.get("origin")!==channel.appOrigin)return fail("來源不符",403);
      const body=await request.json().catch(()=>null);
      const roles=list(body?.roles),groups=list(body?.groups),text=typeof body?.text==="string"?body.text.trim():"";
      if(!["preview","send"].includes(body?.action)||!roles?.length||!roles.every(role=>lineAudienceRoles.includes(role))||
        !groups||!groups.every(group=>options.includes(group))||!text||text.length>1000||
        (!groups.length&&roles.some(role=>["parent","teacher"].includes(role))&&body.allSchool!==true)||
        !/^[0-9a-f-]{36}$/i.test(body.requestId||""))return fail("請確認通知對象、團別及公告文字");
      const audience=await resolveLineAudience(schoolId,channel.botUserId,{roles,groups,students});
      const preview=createHash("sha256").update(JSON.stringify([schoolId,access.email,channel.botUserId,body.requestId,roles,groups,text,audience.targets])).digest("hex");
      const counts={matched:audience.matched,deliverable:audience.targets.length,unbound:audience.unbound};
      if(body.action==="preview")return json({...counts,preview});
      if(body.preview!==preview)return fail("收件名單或內容已變更，請重新預覽",409);
      if(!audience.targets.length)return fail("沒有可發送的 LINE 收件者",409);
      let accepted=0,failed=0;
      const prefix=process.env.LAB_ENVIRONMENT==="functional-uat"?"【LAB｜學校公告】":"【學校公告】";
      for(let index=0;index<audience.targets.length;index+=500){
        const recipients=audience.targets.slice(index,index+500);
        try{
          await lineApi("/v2/bot/message/multicast",{accessToken:channel.accessToken,
            retryKey:workflowLineRetryKey(schoolId,preview,String(index)),
            body:{to:recipients,messages:[{type:"text",text:prefix+"\n"+text}]}});
          accepted+=recipients.length;
        }catch(error){
          failed+=recipients.length;
          console.warn("LINE announcement batch failed",{schoolId,requestId:body.requestId,batch:index,status:error?.status||error?.statusCode});
        }
      }
      return json({...counts,accepted,failed});
    }catch(error){
      console.warn("LINE announcement request failed",{schoolId,status:error?.status||error?.statusCode});
      return fail("公告作業暫時無法完成，請重新預覽",503);
    }
  }
});
