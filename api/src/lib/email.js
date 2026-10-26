import { EmailClient } from "@azure/communication-email";

function clean(v,max=500){return String(v||"").trim().slice(0,max)}
function esc(v){return clean(v,2000).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]))}

function config(){
  return {
    connectionString:clean(process.env.ACS_EMAIL_CONNECTION_STRING,2000),
    senderAddress:clean(process.env.ACS_EMAIL_SENDER,320)
  };
}

export function emailConfigured(){
  const c=config();
  return !!(c.connectionString&&c.senderAddress);
}

export async function sendPaymentRequiredEmail({recipient="",category="uniform",schoolName="弦樂團",title="",studentNames=[],amount=null,size="",quantity=1,appUrl="",reminder=false}={}){
  const address=clean(recipient,320).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))return {status:"failed"};
  const c=config();if(!c.connectionString||!c.senderAddress)return {status:"not_configured"};
  let link;try{const url=new URL(appUrl);if(url.protocol!=="https:"||url.username||url.password)throw Error();link=url.origin+"/"}catch{return {status:"failed"}}
  const invitation=category==="dinner_open";
  const subject=`【${clean(schoolName,120)}】${clean(title,120)}｜${invitation?"開放報名與繳費，請登入平台辦理":(reminder?"再次提醒：尚未回報匯款，請登入平台處理":"待匯款，請登入平台處理")}`;
  const lines=["家長您好：","",invitation?"期末餐會已開放報名與繳費。若要參加，請登入平台確認參加人數、應繳金額及收款帳戶，再依畫面完成匯款與報名。":"您有一筆需要匯款的申請，請登入平台查看收款帳戶並處理付款。",
    "項目："+clean(title,120),!invitation&&studentNames.length?"學生："+studentNames.map(x=>clean(x,80)).join("、"):"",
    !invitation&&Number.isSafeInteger(amount)&&amount>0?"應繳金額：NT$ "+amount.toLocaleString("zh-TW"):"",size?"尺寸："+clean(size,20)+"｜件數："+Number(quantity):"","",
    "平台登入網址："+link,"請使用已綁定的家長 Gmail 登入。",invitation?"登入後請至「活動與團服 → 餐會」確認並辦理。":"登入後請查看首頁付款提醒，或至「活動與團服」查看對應項目。",
    "完成匯款後，請回報匯款日期與轉出帳號末五碼，送出後等待財務核帳。",
    invitation?"餐會依平台既有流程於報名時一併回報匯款。已由其他家長完成報名或已回報匯款者，無須重複辦理。":"若您已完成匯款但尚未回報，請登入補填；若已回報，請等待財務核帳，無須重複匯款。",
    "收款帳戶與最新應繳金額請以登入平台後的資訊為準。"];
  const plainText=lines.filter((line,i)=>line||i===1).join("\n");
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.8"><h2>${esc(subject)}</h2>${lines.filter(Boolean).map(line=>`<p>${esc(line)}</p>`).join("")}<p><a href="${esc(link)}" style="display:inline-block;background:#20543e;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">登入平台處理</a></p></div>`;
  const result=await sendOne(new EmailClient(c.connectionString),c.senderAddress,address,{subject,plainText,html});
  return {status:String(result.status).toLowerCase()==="succeeded"?"sent":String(result.status).toLowerCase()==="failed"?"failed":"unconfirmed",id:result.id};
}

export async function sendUniformRequestStatusEmail({recipients=[],studentName="",kind="",status="",size="",quantity=1}={}){
  const addresses=[...new Set(recipients.map(x=>clean(x,320).toLowerCase()).filter(x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))];
  if(!addresses.length)return {status:"no_recipients"};
  const c=config();if(!c.connectionString||!c.senderAddress)return {status:"not_configured"};
  const item=kind==="competitionUniform"?"A 團比賽服":"團 T";
  const state={PENDING:"申請內容已更正，待學校審核",APPROVED:"已核准，等待統一採購",ORDERED:"已統一採購，等待到貨",ARRIVED:"已到貨，等待領取安排",READY_FOR_PICKUP:"可以領取，請依學校通知辦理",CANCELLED:"申請已取消",FULFILLED:"已完成領用"}[status];
  if(!state)return {status:"unsupported"};
  const subject=`【弦樂團】${clean(studentName,80)}的${item}申請進度更新：${state}`;
  const detail=`學生：${clean(studentName,80)}\n項目：${item}\n尺寸：${clean(size,20)}\n件數：${Number(quantity)||1}\n目前進度：${state}`;
  const next=status==="APPROVED"?"核准不代表已付款、到貨或可以領取。採購及領取進度仍需等待後續通知。":"請登入平台「活動與團服 → 我的紀錄」查看最新進度。";
  const plainText=`您好：\n\n您的團服申請狀態已更新。\n${detail}\n\n${next}\n請登入平台「活動與團服 → 我的紀錄」查詢最新狀態。`;
  const html=`<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>${esc(subject)}</h2><p>您的團服申請狀態已更新。</p><p>${esc(detail).replaceAll("\n","<br>")}</p><p>${esc(next)}</p><p>請登入平台「活動與團服 → 我的紀錄」查詢最新狀態。</p></div>`;
  const client=new EmailClient(c.connectionString);
  const results=await Promise.allSettled(addresses.map(address=>sendOne(client,c.senderAddress,address,{subject,plainText,html})));
  return {status:results.every(x=>x.status==="fulfilled"&&String(x.value.status).toLowerCase()==="succeeded")?"sent":"partial",recipientCount:addresses.length,sentCount:results.filter(x=>x.status==="fulfilled"&&String(x.value.status).toLowerCase()==="succeeded").length};
}

async function sendOne(client,senderAddress,address,message){
  const poller=await client.beginSend({
    senderAddress,
    content:{
      subject:message.subject,
      plainText:message.plainText,
      html:message.html
    },
    recipients:{to:[{address}]}
  });
  const result=await poller.pollUntilDone();
  return {address,status:String(result?.status||"unknown"),id:String(result?.id||"")};
}

const privateLessonMailCopy={
  scheduled:{title:"個別課預約通知",lead:"老師已建立個別課預約，請確認以下日期與時間。",action:"查看個別課預約"},
  rescheduled:{title:"個別課改期通知",lead:"個別課預約日期或時間已更新，請確認新的安排。",action:"查看最新預約"},
  cancelled:{title:"個別課停課通知",lead:"這堂個別課已取消；系統已同步更新雙方的預約紀錄。",action:"查看個別課紀錄"},
  completed:{title:"個別課完成確認",lead:"老師已完成本次個別課，請家長登入系統確認已完成上課。",action:"確認完成上課"},
  confirmed:{title:"家長已確認個別課",lead:"家長已確認本次個別課完成，課程流程已正式結案。",action:"查看個別課紀錄"},
  issue:{title:"家長回報個別課問題",lead:"家長對本次個別課完成紀錄提出問題，請登入系統確認。",action:"查看回報內容"}
};

export async function sendPrivateLessonWorkflowEmail({
  recipients=[],eventType="completed",schoolName="",studentName="",teacherName="",lessonDate="",startTime="",endTime="",minutes=0,
  lessonContent="",previousDate="",previousStartTime="",previousEndTime="",reason="",note="",actorName="",appUrl="",confirmUrl=""
}={}){
  const emails=[...new Set((Array.isArray(recipients)?recipients:[]).map(x=>clean(x,320).toLowerCase()).filter(Boolean))];
  if(!emails.length)return {status:"no_recipients",recipientCount:0,sentCount:0,failedCount:0};
  const c=config();
  if(!c.connectionString||!c.senderAddress)return {status:"not_configured",recipientCount:emails.length,sentCount:0,failedCount:0};

  const type=Object.hasOwn(privateLessonMailCopy,eventType)?eventType:"completed",copy=privateLessonMailCopy[type];
  const school=clean(schoolName,120)||"弦樂團管理系統";
  const subject=`【${school}】${clean(studentName,80)||"學生"} ${copy.title}`;
  const teacher=clean(teacherName,100)||"個別課老師";
  const date=clean(lessonDate,20),timeText=[clean(startTime,10),clean(endTime,10)].filter(Boolean).join("～");
  const oldDate=clean(previousDate,20),oldTimeText=[clean(previousStartTime,10),clean(previousEndTime,10)].filter(Boolean).join("～");
  const content=clean(lessonContent,500);
  const why=clean(reason,300),parentNote=clean(note,500),actor=clean(actorName,100);
  const link=clean(appUrl||confirmUrl,1000);
  const plainText=[
    `${school}｜${copy.title}`,
    "",
    copy.lead,
    actor?`異動人員：${actor}`:"",
    oldDate?`原日期：${oldDate}`:"",
    oldTimeText?`原時間：${oldTimeText}`:"",
    `學生：${clean(studentName,80)}`,
    `老師：${teacher}`,
    `日期：${date}`,
    `時間：${timeText}`,
    `課程分鐘：${Number(minutes||0)} 分鐘`,
    content?`課程內容：${content}`:"",
    why?`原因：${why}`:"",
    parentNote?`備註：${parentNote}`:"",
    "",
    link?`${copy.action}：${link}`:""
  ].filter(Boolean).join("\n");
  const html=`<div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.7;color:#173d31;max-width:640px"><h2 style="color:#1f5a46">🎻 ${esc(school)}｜${esc(copy.title)}</h2><p>${esc(copy.lead)}</p><table style="border-collapse:collapse">${actor?`<tr><td style="padding:4px 12px 4px 0"><b>異動人員</b></td><td>${esc(actor)}</td></tr>`:""}${oldDate?`<tr><td style="padding:4px 12px 4px 0"><b>原日期</b></td><td>${esc(oldDate)}</td></tr>`:""}${oldTimeText?`<tr><td style="padding:4px 12px 4px 0"><b>原時間</b></td><td>${esc(oldTimeText)}</td></tr>`:""}<tr><td style="padding:4px 12px 4px 0"><b>學生</b></td><td>${esc(studentName)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>老師</b></td><td>${esc(teacher)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>日期</b></td><td>${esc(date)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>時間</b></td><td>${esc(timeText)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>分鐘</b></td><td>${Number(minutes||0)} 分鐘</td></tr>${content?`<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>課程內容</b></td><td>${esc(content)}</td></tr>`:""}${why?`<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>原因</b></td><td>${esc(why)}</td></tr>`:""}${parentNote?`<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>備註</b></td><td>${esc(parentNote)}</td></tr>`:""}</table>${link?`<p style="margin-top:20px"><a href="${esc(link)}" style="display:inline-block;background:#1f5a46;color:white;text-decoration:none;padding:10px 18px;border-radius:8px">${esc(copy.action)}</a></p>`:""}<p style="font-size:12px;color:#6c7f77">此信由 ${esc(school)} 系統自動寄出，請勿直接回覆。</p></div>`;

  const client=new EmailClient(c.connectionString);
  const results=await Promise.allSettled(emails.map(address=>sendOne(client,c.senderAddress,address,{subject,plainText,html})));
  const sent=results.filter(r=>r.status==="fulfilled"&&String(r.value?.status).toLowerCase()==="succeeded").length;
  const accepted=results.filter(r=>r.status==="fulfilled").length;
  const failed=results.length-accepted;
  return {
    status:failed===0&&sent===emails.length?"sent":accepted>0?"partial":"failed",
    recipientCount:emails.length,
    sentCount:sent||accepted,
    failedCount:failed,
    results:results.map(r=>r.status==="fulfilled"?{status:r.value.status,id:r.value.id}:{status:"failed",error:clean(r.reason?.message||r.reason,300)})
  };
}

export async function sendPrivateLessonParentEmail(options={}){
  return sendPrivateLessonWorkflowEmail({...options,eventType:"completed",appUrl:options.appUrl||options.confirmUrl||""});
}


export async function sendParentApprovalEmail({recipient="",parentName="",studentName="",grade="",groupName="",instrument=""}={}){
  const address=clean(recipient,320).toLowerCase();
  if(!address)return {status:"no_recipient",recipientCount:0,sentCount:0,failedCount:0};
  const cfg=config();
  if(!cfg.connectionString||!cfg.senderAddress)return {status:"not_configured",recipientCount:1,sentCount:0,failedCount:0};

  const parent=clean(parentName,80)||"家長";
  const student=clean(studentName,80);
  const group=clean(groupName,20);
  const subject="【聖心小學弦樂團】家長帳號認證完成";
  const plainText=[
    "聖心小學弦樂團｜家長帳號認證完成",
    "",
    `${parent} 您好：`,
    `您申請綁定的學生「${student}」已完成資料確認與家長帳號認證。`,
    "",
    `學生：${student}`,
    `年級：${clean(grade,40)}`,
    `團別：${group}團`,
    `樂器：${clean(instrument,40)}`,
    "",
    "您現在可以使用原申請的 Gmail 登入聖心小學弦樂團管理系統，查看孩子的課程、出缺勤、自主練習及相關紀錄。",
    "",
    "若資料有誤，請聯繫弦樂團家長會協助確認。",
    "聖心小學弦樂團家長會"
  ].join("\n");
  const htmlBody=`<div style="font-family:Arial,'Noto Sans TC','Microsoft JhengHei',sans-serif;line-height:1.7;color:#173d31;max-width:620px">
    <h2 style="color:#1f5a46;margin-bottom:6px">🎻 聖心小學弦樂團</h2>
    <h3 style="margin-top:0">家長帳號認證完成</h3>
    <p>${esc(parent)} 您好：</p>
    <p>您申請綁定的學生「<b>${esc(student)}</b>」已完成資料確認與家長帳號認證。</p>
    <div style="padding:14px 16px;border:1px solid #d7e1dc;border-radius:8px;background:#f8fbf9">
      <b>學生：</b>${esc(student)}<br>
      <b>年級：</b>${esc(grade)}<br>
      <b>團別：</b>${esc(group)}團<br>
      <b>樂器：</b>${esc(instrument)}
    </div>
    <p>您現在可以使用原申請的 Gmail 登入「聖心小學弦樂團管理系統」，查看孩子的課程、出缺勤、自主練習及相關紀錄。</p>
    <p style="font-size:12px;color:#6c7f77">若資料有誤，請聯繫弦樂團家長會協助確認。此信由系統自動寄出，請勿直接回覆。</p>
    <p>聖心小學弦樂團家長會</p>
  </div>`;

  try{
    const client=new EmailClient(cfg.connectionString);
    const result=await sendOne(client,cfg.senderAddress,address,{subject,plainText,html:htmlBody});
    const ok=String(result?.status||"").toLowerCase()==="succeeded";
    return {status:ok?"sent":"failed",recipientCount:1,sentCount:ok?1:0,failedCount:ok?0:1,messageId:result?.id||"",rawStatus:result?.status||""};
  }catch(e){
    console.error("parent approval email failed",e);
    return {status:"failed",recipientCount:1,sentCount:0,failedCount:1,error:clean(e?.message||e,500)};
  }
}


export async function sendTeacherAccessEnabledEmail({
  recipient="",teacherName="",schoolName="",appUrl="",privateOnly=false,boundStudentCount=0
}={}){
  const address=clean(recipient,320).toLowerCase();
  if(!address)return {status:"no_recipient",recipientCount:0,sentCount:0,failedCount:0};
  const cfg=config();
  if(!cfg.connectionString||!cfg.senderAddress)return {status:"not_configured",recipientCount:1,sentCount:0,failedCount:0};

  const teacher=clean(teacherName,80)||"老師";
  const school=clean(schoolName,120)||"弦樂團管理系統";
  const link=clean(appUrl,1000);
  const permissionText=privateOnly
    ? `個別課老師權限已開通，目前綁定 ${Number(boundStudentCount||0)} 位學生；登入後僅會看到已授權的個別課學生與功能。`
    : "教學老師帳號已開通；登入後可依管理員已設定的教學範圍使用點名、教學、自主練習與相關功能。";
  const subject=`【${school}】老師帳號權限已開通`;
  const plainText=[
    `${school}｜老師帳號權限已開通`,
    "",
    `${teacher} 老師您好：`,
    "您的老師帳號已由學校管理員完成建立並啟用。",
    "",
    `登入帳號：${address}`,
    `權限說明：${permissionText}`,
    "",
    "請使用以上 Google / Gmail 帳號登入系統。",
    link?`系統登入：${link}`:"",
    "",
    "若登入後看不到應有的學生或課程，請聯繫學校管理員協助確認。",
    "此信由系統自動寄出，請勿直接回覆。"
  ].filter(Boolean).join("\n");
  const html=`<div style="font-family:Arial,'Noto Sans TC','Microsoft JhengHei',sans-serif;line-height:1.7;color:#173d31;max-width:620px">
    <h2 style="color:#3155a4;margin-bottom:6px">🎻 ${esc(school)}</h2>
    <h3 style="margin-top:0">老師帳號權限已開通</h3>
    <p>${esc(teacher)} 老師您好：</p>
    <p>您的老師帳號已由學校管理員完成建立並啟用。</p>
    <div style="padding:14px 16px;border:1px solid #d8e0f2;border-radius:10px;background:#f7f9ff">
      <b>登入帳號：</b>${esc(address)}<br>
      <b>權限說明：</b>${esc(permissionText)}
    </div>
    <p>請使用以上 Google / Gmail 帳號登入系統。</p>
    ${link?`<p><a href="${esc(link)}" style="display:inline-block;background:#3155a4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:700">登入弦樂團系統</a></p>`:""}
    <p style="font-size:12px;color:#6c7f77">若登入後看不到應有的學生或課程，請聯繫學校管理員協助確認。此信由系統自動寄出，請勿直接回覆。</p>
  </div>`;

  try{
    const client=new EmailClient(cfg.connectionString);
    const result=await sendOne(client,cfg.senderAddress,address,{subject,plainText,html});
    const ok=String(result?.status||"").toLowerCase()==="succeeded";
    return {status:ok?"sent":"failed",recipientCount:1,sentCount:ok?1:0,failedCount:ok?0:1,messageId:result?.id||"",rawStatus:result?.status||""};
  }catch(e){
    console.error("teacher access email failed",e);
    return {status:"failed",recipientCount:1,sentCount:0,failedCount:1,error:clean(e?.message||e,500)};
  }
}
