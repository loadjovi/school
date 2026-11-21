import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {lineAudienceGroups,lineAudienceRoles,lineAudienceStudents,resolveLineAudience} from "../lib/lineAudience.js";
import {workflowLineEnabled,workflowLineRetryKey} from "../lib/lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {pushLineMessage,getLineGroupSummary} from "../lib/lineMessaging.mjs";
import {listActivityLineGroups,requireLineActivity,getActivityLineGroup,createActivityLineBinding,clearActivityLineGroup,recordLineAnnouncement,lineAnnouncementHistory} from "../lib/lineActivityGroups.js";

const list=values=>Array.isArray(values)&&values.every(value=>typeof value==="string")?[...new Set(values)].sort():null;
const fail=(error,status=400)=>json({error},status);
const rolesText={parent:"家長",teacher:"老師",staff:"幹部",finance:"財務幹部"};
app.http("lineAnnouncements",{
  methods:["GET","POST"],authLevel:"anonymous",route:"line/announcements",
  handler:async request=>{
    const ctx=await getTenantContext(request);if(ctx.error)return ctx.error;
    const {schoolId,access}=ctx;
    if(access.role!=="admin")return fail("僅學校管理員可使用 LINE 通知中心",403);
    try{
      const channel=await resolveTenantLineChannel(schoolId);
      if(!channel.configured||!channel.loginConfigured||!channel.botUserId||!workflowLineEnabled())return fail("此環境尚未啟用 LINE 通知中心",409);
      if(request.method==="GET"){
        const [students,activities,history]=await Promise.all([lineAudienceStudents(schoolId),listActivityLineGroups(schoolId,channel.botUserId),lineAnnouncementHistory(schoolId)]);
        return json({groups:lineAudienceGroups(students),activities,history,schoolName:ctx.tenant?.systemName||ctx.tenant?.schoolName||"學校平台"});
      }
      if(request.headers.get("origin")!==channel.appOrigin)return fail("來源不符",403);
      const body=await request.json().catch(()=>null);
      const selectedKey=typeof body?.activityKey==="string"?body.activityKey:"";
      if(body?.action==="activity-binding-code")return json(await createActivityLineBinding(channel,selectedKey,access.email));
      if(body?.action==="activity-unbind"){
        await clearActivityLineGroup(schoolId,channel.botUserId,selectedKey);return json({ok:true});
      }
      const text=typeof body?.text==="string"?body.text.trim():"",mode=body?.audience||"members";
      if(!["preview","send"].includes(body?.action)||!["members","activityGroup"].includes(mode)||!text||text.length>1000||!/^[0-9a-f-]{36}$/i.test(body.requestId||""))return fail("請確認通知對象及訊息內容");
      let roles=[],groups=[],targets=[],recipients=[],matched=0,unbound=0,targetLabel="";
      if(mode==="activityGroup"){
        const selected=await requireLineActivity(schoolId,selectedKey),group=await getActivityLineGroup(schoolId,channel.botUserId,selectedKey);
        if(!group)return fail("請先為此活動綁定志工 LINE 群組",409);
        const current=await getLineGroupSummary(group.groupId,channel);
        if(!current)return fail("暫時無法確認此志工群組，請確認官方帳號仍在群內再重新預覽",409);
        targets=[group.groupId];matched=1;targetLabel=selected.title+"｜"+(current.groupName||group.groupName);
      }else{
        const students=await lineAudienceStudents(schoolId),options=lineAudienceGroups(students);
        roles=list(body?.roles);groups=list(body?.groups);
        if(!roles?.length||!roles.every(role=>lineAudienceRoles.includes(role))||!groups)return fail("請選擇收件角色");
        const memberRoles=roles.filter(role=>["parent","teacher"].includes(role));
        if(memberRoles.length){
          if(!groups.every(group=>options.includes(group))||!groups.length&&body.allSchool!==true)return fail("請選擇所有團別或指定團別");
        }else groups=[];
        const audience=await resolveLineAudience(schoolId,channel.botUserId,{roles,groups,students});
        targets=[...new Set(audience.targets)].sort();matched=audience.matched;unbound=audience.unbound;
        const names=new Map((audience.recipients||[]).map(recipient=>[recipient.userId,recipient.name]));
        recipients=targets.map((userId,index)=>({reference:createHash("sha256").update(JSON.stringify([schoolId,channel.botUserId,userId])).digest("hex").slice(0,12),name:String(names.get(userId)||"LINE 帳號 "+(index+1)).slice(0,80)}));
        const labels=[];
        if(memberRoles.length)labels.push((groups.length?groups.map(group=>({A:"A 團",B:"B 團",儲備:"儲備團"})[group]||group).join("、"):"所有團別")+"的"+memberRoles.map(role=>rolesText[role]).join("與"));
        if(roles.includes("staff"))labels.push("本校全體幹部（含財務幹部）");
        else if(roles.includes("finance"))labels.push("本校財務幹部");
        targetLabel=labels.join("；另通知");
      }
      const preview=createHash("sha256").update(JSON.stringify([schoolId,access.email,channel.botUserId,body.requestId,mode,mode==="activityGroup"?selectedKey:"",roles,groups,text,targetLabel,targets])).digest("hex");
      const deliveryMode=mode==="activityGroup"?"group":"push";
      const counts={matched,deliverable:targets.length,unbound,targetLabel,audience:mode,recipients,deliveryMode,deliveryConfirmed:false};
      if(body.action==="preview")return json({...counts,preview});
      if(body.preview!==preview)return fail("收件名單、群組或內容已變更，請重新預覽",409);
      if(!targets.length)return fail("沒有可發送的 LINE 收件者",409);
      let accepted=0,failed=0,recipientResults=[];
      const label=mode==="activityGroup"?"活動志工通知":"學校公告";
      const prefix=process.env.LAB_ENVIRONMENT==="functional-uat"?`【LAB｜${label}】`:`【${label}】`;
      if(mode==="activityGroup"){
        try{
          await pushLineMessage(targets[0],prefix+"\n"+targetLabel+"\n\n"+text,{accessToken:channel.accessToken,retryKey:workflowLineRetryKey(schoolId,preview,"activity-group")});accepted=1;
        }catch(error){failed=1;console.warn("Activity group LINE send failed",{schoolId,status:error?.status||error?.statusCode})}
      }else for(let index=0;index<targets.length;index+=10){
        const results=await Promise.all(targets.slice(index,index+10).map(async(userId,offset)=>{
          const recipient=recipients[index+offset],options={accessToken:channel.accessToken,retryKey:workflowLineRetryKey(schoolId,"announcement-push:"+preview,userId)};
          try{
            await pushLineMessage(userId,prefix+"\n"+text,options).catch(error=>{
              const code=error?.status||error?.statusCode;if(code&&code<500)throw error;
              return pushLineMessage(userId,prefix+"\n"+text,options);
            });
            return {...recipient,status:"accepted"};
          }catch(error){
            const code=Number(error?.status||error?.statusCode);
            console.warn("LINE announcement recipient failed",{schoolId,status:Number.isInteger(code)?code:undefined});
            return {...recipient,status:"failed",...(Number.isInteger(code)&&code>=100&&code<600?{httpStatus:code}:{})};
          }
        }));
        recipientResults.push(...results);accepted+=results.filter(result=>result.status==="accepted").length;failed+=results.filter(result=>result.status==="failed").length;
      }
      let historySaved=true;
      try{await recordLineAnnouncement(schoolId,{requestId:body.requestId,audience:mode,label:targetLabel,text,accepted,failed,deliveryMode,recipientResults,actor:access.email})}
      catch{historySaved=false;console.warn("LINE notification history could not be saved",{schoolId})}
      return json({...counts,accepted,failed,recipientResults,historySaved});
    }catch(error){
      if(error.status===409)return fail(error.message,409);
      console.warn("LINE notification request failed",{schoolId,status:error?.status||error?.statusCode});
      return fail("LINE 通知作業暫時無法完成，請重新預覽",503);
    }
  }
});
