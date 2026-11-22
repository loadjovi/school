import {app} from "@azure/functions";
import {createHash} from "node:crypto";
import {getTenantContext,json} from "../lib/auth.js";
import {lineAudienceGroups,lineAudienceRoles,lineAudienceStudents,resolveLineAudience} from "../lib/lineAudience.js";
import {workflowLineEnabled,workflowLineRetryKey} from "../lib/lineAdminTodoNotification.mjs";
import {resolveTenantLineChannel} from "../lib/lineTenantConfig.js";
import {pushLineMessage,getLineGroupSummary} from "../lib/lineMessaging.mjs";
import {listActivityLineGroups,listSchoolLineGroups,schoolLineGroupTarget,requireLineActivity,getActivityLineGroup,createActivityLineBinding,clearActivityLineGroup,recordLineAnnouncement,lineAnnouncementHistory} from "../lib/lineActivityGroups.js";
import {lineFirstLabEnabled,deliverLabNotice,labNoticeUrl} from "../lib/labNoticeDelivery.mjs";

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
      const lineFirst=typeof lineFirstLabEnabled==="function"&&lineFirstLabEnabled();
      if((!channel.configured||!channel.loginConfigured||!channel.botUserId)&&!lineFirst||!workflowLineEnabled())return fail("此環境尚未啟用 LINE 通知中心",409);
      if(request.method==="GET"){
        const [students,activities,schoolGroups,history]=await Promise.all([lineAudienceStudents(schoolId),listActivityLineGroups(schoolId,channel.botUserId),listSchoolLineGroups(schoolId,channel.botUserId),lineAnnouncementHistory(schoolId)]);
        return json({groups:lineAudienceGroups(students),activities,schoolGroups,history,lineFirst,schoolName:ctx.tenant?.systemName||ctx.tenant?.schoolName||"學校平台"});
      }
      if(request.headers.get("origin")!==(channel.appOrigin||(lineFirst?new URL(labNoticeUrl(schoolId)).origin:"")))return fail("來源不符",403);
      const body=await request.json().catch(()=>null);
      const selectedKey=typeof body?.activityKey==="string"?body.activityKey:"";
      if(["school-binding-code","school-unbind"].includes(body?.action)){
        const selected=schoolLineGroupTarget(body.schoolGroupKey);
        if(!channel.configured||!channel.botUserId||!channel.accessToken)return fail("請先設定此校 LINE 官方帳號",409);
        if(body.action==="school-binding-code")return json(await createActivityLineBinding(channel,selected.key,access.email));
        await clearActivityLineGroup(schoolId,channel.botUserId,selected.key);return json({ok:true});
      }
      if(body?.action==="activity-binding-code")return json(await createActivityLineBinding(channel,selectedKey,access.email));
      if(body?.action==="activity-unbind"){
        await clearActivityLineGroup(schoolId,channel.botUserId,selectedKey);return json({ok:true});
      }
      const text=typeof body?.text==="string"?body.text.trim():"",mode=body?.audience||"members";
      if(!["preview","send"].includes(body?.action)||!["members","activityGroup","schoolGroups"].includes(mode)||!text||text.length>1000||!/^[0-9a-f-]{36}$/i.test(body.requestId||""))return fail("請確認通知對象及訊息內容");
      let roles=[],groups=[],targets=[],memberTargets=[],recipients=[],contacts=[],matched=0,unbound=0,targetLabel="";
      const groupTargets=new Map(),labels=[];
      let schoolKeys=list(body.schoolGroupKeys||[]);if(!schoolKeys)return fail("請選擇學校 LINE 群組");
      const reference=target=>createHash("sha256").update(JSON.stringify([schoolId,channel.botUserId,target])).digest("hex").slice(0,12);
      async function addGroup(key,selected){
        const group=await getActivityLineGroup(schoolId,channel.botUserId,key);
        if(!group)throw Object.assign(Error("請先綁定「"+selected.title+"」"),{status:409});
        const current=await getLineGroupSummary(group.groupId,channel);
        if(!current)throw Object.assign(Error("無法確認「"+selected.title+"」，請確認此校官方帳號仍在群內後重新預覽"),{status:409});
        labels.push(selected.title+"｜"+(current.groupName||group.groupName));
        groupTargets.set(group.groupId,{to:group.groupId,name:String(current.groupName||group.groupName).slice(0,80),kind:"group",reference:reference(group.groupId)});
      }
      if(mode==="activityGroup"){
        schoolKeys=[];await addGroup(selectedKey,await requireLineActivity(schoolId,selectedKey));
      }else if(mode==="schoolGroups"){
        if(!schoolKeys.length)return fail("請勾選至少一個學校 LINE 群組");
      }else{
        const students=await lineAudienceStudents(schoolId),options=lineAudienceGroups(students);
        roles=list(body?.roles);groups=list(body?.groups);
        if(!roles?.length||!roles.every(role=>lineAudienceRoles.includes(role))||!groups)return fail("請選擇收件角色");
        const memberRoles=roles.filter(role=>["parent","teacher"].includes(role));
        // Older pages may still submit staff roles; these now resolve only to a bound group.
        if(roles.includes("staff"))schoolKeys.push("school:cadres");else if(roles.includes("finance"))schoolKeys.push("school:finance");
        roles=memberRoles;
        if(memberRoles.length){
          if(!groups.every(group=>options.includes(group))||!groups.length&&body.allSchool!==true)return fail("請選擇所有團別或指定團別");
        }else groups=[];
        const audience=memberRoles.length?await resolveLineAudience(schoolId,channel.botUserId,{roles:memberRoles,groups,students}):{targets:[],contacts:[],recipients:[],matched:0,unbound:0};
        contacts=audience.contacts||[];
        memberTargets=[...new Set(audience.targets)].sort();matched=audience.matched;unbound=audience.unbound;
        const names=new Map((audience.recipients||[]).map(recipient=>[recipient.userId,recipient.name]));
        recipients=memberTargets.map((userId,index)=>({reference:reference(userId),name:String(names.get(userId)||"LINE 帳號 "+(index+1)).slice(0,80)}));
        if(memberRoles.length)labels.push((groups.length?groups.map(group=>({A:"A 團",B:"B 團",儲備:"儲備團"})[group]||group).join("、"):"所有團別")+"的"+memberRoles.map(role=>rolesText[role]).join("與"));
      }
      schoolKeys=[...new Set(schoolKeys)].sort();for(const key of schoolKeys)await addGroup(key,schoolLineGroupTarget(key));
      const groupList=[...groupTargets.values()].sort((a,b)=>a.to.localeCompare(b.to));
      targets=[...memberTargets,...groupList.map(group=>group.to)];recipients.push(...groupList.map(({to,...recipient})=>recipient));targetLabel=labels.join("；另通知");
      const preview=createHash("sha256").update(JSON.stringify([schoolId,access.email,channel.botUserId,body.requestId,mode,mode==="activityGroup"?selectedKey:"",roles,groups,schoolKeys,text,targetLabel,targets,...(lineFirst?[contacts]:[])])).digest("hex");
      const deliveryMode=groupList.length?(memberTargets.length||contacts.length?"mixed":"group"):"push";
      const counts={matched,deliverable:targets.length,memberDeliverable:memberTargets.length,groupDeliverable:groupList.length,unbound,targetLabel,audience:mode,recipients,deliveryMode,deliveryConfirmed:false,...(lineFirst?{emailFallbackCandidates:contacts.filter(contact=>!contact.userId).length,lineFirst:true}:{})};
      if(body.action==="preview")return json({...counts,preview});
      if(body.preview!==preview)return fail("收件名單、群組或內容已變更，請重新預覽",409);
      if(!targets.length&&!(lineFirst&&contacts.length))return fail("沒有可發送的 LINE 或 Email 收件者",409);
      let accepted=0,emailAccepted=0,failed=0,groupAccepted=0,groupFailed=0,recipientResults=[];
      const label=mode==="activityGroup"?"活動志工通知":mode==="schoolGroups"?"學校群組通知":"學校公告";
      const prefix=process.env.LAB_ENVIRONMENT==="functional-uat"?`【LAB｜${label}】`:`【${label}】`;
      if(lineFirst&&contacts.length){
        const seenUsers=new Set(),selectedContacts=contacts.filter(contact=>{if(!contact.userId)return true;if(seenUsers.has(contact.userId))return false;seenUsers.add(contact.userId);return true});
        const delivery=await deliverLabNotice({schoolId,eventId:"announcement:"+preview,recipients:selectedContacts.map(contact=>contact.email),subject:"學校公告",text:prefix+"\n"+text});
        for(const result of delivery.results||[]){
          const contact=selectedContacts.find(contact=>contact.email.toLowerCase()===result.recipient);if(!contact)continue;
          if(result?.channel==="line"&&result.status==="accepted"){
            accepted++;
          }else if(result?.channel==="email"&&result.status==="accepted")emailAccepted++;
          else failed++;
          const identity=contact.userId||contact.email,reference=createHash("sha256").update(JSON.stringify([schoolId,channel.botUserId,identity])).digest("hex").slice(0,12);
          recipientResults.push({reference,name:recipients.find(r=>r.reference===reference)?.name||"Email 備援帳號",status:result?.status==="accepted"?(result.channel==="email"?"email_accepted":"accepted"):"failed"});
        }
      }else for(let index=0;index<memberTargets.length;index+=10){
        const results=await Promise.all(memberTargets.slice(index,index+10).map(async(userId,offset)=>{
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
      for(const group of groupList){
        const {to,...recipient}=group;
        try{await pushLineMessage(to,prefix+"\n"+targetLabel+"\n\n"+text,{accessToken:channel.accessToken,retryKey:workflowLineRetryKey(schoolId,preview,"group:"+to)});accepted++;groupAccepted++;recipientResults.push({...recipient,status:"accepted"})}
        catch(error){failed++;groupFailed++;recipientResults.push({...recipient,status:"failed"});console.warn("LINE group send failed",{schoolId,status:error?.status||error?.statusCode})}
      }
      let historySaved=true;
      try{await recordLineAnnouncement(schoolId,{requestId:body.requestId,audience:mode,label:targetLabel,text,accepted,emailAccepted,failed,groupAccepted,groupFailed,deliveryMode,recipientResults,actor:access.email})}
      catch{historySaved=false;console.warn("LINE notification history could not be saved",{schoolId})}
      return json({...counts,accepted,emailAccepted,failed,groupAccepted,groupFailed,recipientResults,historySaved,...(groupFailed?{fallbackStatus:"no_group_email_roster"}:{})});
    }catch(error){
      if(error.status===409)return fail(error.message,409);
      console.warn("LINE notification request failed",{schoolId,status:error?.status||error?.statusCode});
      return fail("LINE 通知作業暫時無法完成，請重新預覽",503);
    }
  }
});
