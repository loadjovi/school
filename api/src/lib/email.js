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

export async function sendPrivateLessonParentEmail({recipients=[],studentName="",teacherName="",lessonDate="",startTime="",endTime="",minutes=0,lessonContent="",confirmUrl=""}={}){
  const emails=[...new Set((Array.isArray(recipients)?recipients:[]).map(x=>clean(x,320).toLowerCase()).filter(Boolean))];
  if(!emails.length)return {status:"no_recipients",recipientCount:0,sentCount:0,failedCount:0};
  const c=config();
  if(!c.connectionString||!c.senderAddress)return {status:"not_configured",recipientCount:emails.length,sentCount:0,failedCount:0};

  const subject=`【聖心小學弦樂團】${clean(studentName,80)||"學生"} 個別課完成確認`;
  const teacher=clean(teacherName,100)||"個別課老師";
  const date=clean(lessonDate,20),timeText=[clean(startTime,10),clean(endTime,10)].filter(Boolean).join("～");
  const content=clean(lessonContent,500);
  const link=clean(confirmUrl,1000);
  const plainText=[
    "聖心小學弦樂團｜個別課完成確認",
    "",
    `學生：${clean(studentName,80)}`,
    `老師：${teacher}`,
    `日期：${date}`,
    `時間：${timeText}`,
    `課程分鐘：${Number(minutes||0)} 分鐘`,
    content?`課程內容：${content}`:"",
    "",
    "老師已完成本次個別課紀錄，請登入弦樂團系統確認學生已完成上課。",
    link?`確認連結：${link}`:""
  ].filter(Boolean).join("\n");
  const html=`<div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.7;color:#173d31"><h2 style="color:#1f5a46">🎻 聖心小學弦樂團｜個別課完成確認</h2><p>老師已完成本次個別課紀錄，請家長登入系統確認。</p><table style="border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0"><b>學生</b></td><td>${esc(studentName)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>老師</b></td><td>${esc(teacher)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>日期</b></td><td>${esc(date)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>時間</b></td><td>${esc(timeText)}</td></tr><tr><td style="padding:4px 12px 4px 0"><b>分鐘</b></td><td>${Number(minutes||0)} 分鐘</td></tr>${content?`<tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>課程內容</b></td><td>${esc(content)}</td></tr>`:""}</table>${link?`<p style="margin-top:20px"><a href="${esc(link)}" style="display:inline-block;background:#1f5a46;color:white;text-decoration:none;padding:10px 18px;border-radius:8px">查看並確認本次個別課</a></p>`:""}<p style="font-size:12px;color:#6c7f77">此信由聖心小學弦樂團系統自動寄出，請勿直接回覆。</p></div>`;

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
