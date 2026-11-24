// Presentation only. Callers retain recipient, school, lesson and review checks.
const clean=value=>typeof value==="string"||typeof value==="number"?String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu,"").trim():"";
const cut=(value,max)=>{const chars=Array.from(clean(value));return chars.length>max?chars.slice(0,max-1).join("")+"…":chars.join("")};
const palette={blue:"#3856A6",green:"#237A67",amber:"#91651B",red:"#AA3434",ink:"#17324D",muted:"#5C6B78"};
const copy={
 scheduled:{title:"個別課預約通知",status:"已安排上課",next:"請確認上課日期與時間。若需調整，請到平台與老師聯繫。",button:"查看個課預約",color:palette.blue},
 rescheduled:{title:"個別課改期通知",status:"上課時間已調整",next:"請以上方的新日期與時間為準。",button:"查看更新後時間",color:palette.amber},
 cancelled:{title:"個別課停課通知",status:"本次個課已停課",next:"這次時段不用上課；後續安排請與老師確認。",button:"查看停課紀錄",color:palette.red},
 completed:{title:"個別課完成確認",status:"老師已完課，待家長確認",next:"請核對本堂上課內容，再確認完成；如有問題，可到平台回報。",button:"到平台確認／回報問題",color:palette.green},
 confirmed:{title:"個別課確認完成",status:"家長已確認完成上課",next:"家長的確認結果已同步到個課紀錄。",button:"查看個課紀錄",color:palette.green},
 issue:{title:"個別課問題回報",status:"家長回報，待老師核對",next:"請查看家長回報內容，並到平台協助處理。",button:"查看個課問題",color:palette.red}
};
function text(value,{size="sm",color=palette.ink,bold=false,margin}={}){
 return {type:"text",text:clean(value)||"—",size,color,weight:bold?"bold":"regular",wrap:true,scaling:true,...(margin?{margin}:{})};
}
function field(label,value,{large=false,color}={}){
 if(!clean(value))return null;
 return {type:"box",layout:"vertical",spacing:"xs",margin:"md",contents:[text(label,{size:"xs",color:palette.muted}),text(value,{size:large?"lg":"sm",bold:large,color:color||palette.ink})]};
}
function date(value){
 const raw=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/u.test(raw))return raw?cut(raw,40):"日期待確認";
 const parsed=new Date(raw+"T12:00:00+08:00");
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==raw)return "日期待確認";
 return raw+"（"+new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",weekday:"short"}).format(parsed)+"）";
}
function time(start,end){return [cut(start,20),cut(end,20)].filter(Boolean).join("～")||"時間待確認"}
function uri(value,schoolId=""){
 try{
  const url=new URL(clean(value));
  if(url.protocol!=="https:"||url.username||url.password||url.href.length>2000)return "";
  if(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(clean(schoolId)))url.searchParams.set("schoolId",schoolId);
  return url.toString();
 }catch{return ""}
}
function link(label,url){return url?{type:"button",style:"primary",color:palette.blue,height:"md",scaling:true,action:{type:"uri",label,uri:url}}:null}
function card({title,status,studentName="",fields=[],next="",actions=[],color=palette.blue,fallbackText="",lab=false,preview=""}){
 const contents={type:"bubble",size:"mega",header:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",backgroundColor:color,contents:[
  text((lab?"LAB｜":"")+title,{size:"lg",bold:true,color:"#FFFFFF"}),
  ...(studentName?[text(cut(studentName,120),{size:"xl",bold:true,color:"#FFFFFF"})]:[]),
  ...(status?[text(status,{size:"sm",color:"#FFFFFF"})]:[])
 ]},body:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"sm",backgroundColor:"#FFFFFF",contents:fields.filter(Boolean)},
 footer:{type:"box",layout:"vertical",paddingAll:"16px",spacing:"md",backgroundColor:"#FFFFFF",contents:[
  {type:"separator",color:"#D9E1E8"},...(next?[text(next,{size:"sm"})]:[]),...actions.filter(Boolean)
 ]}};
 if(!contents.body.contents.length)contents.body.contents.push(text(status||title));
 const fallback=cut(fallbackText||[title,studentName,status,next].filter(Boolean).join("\n"),5000);
 const result={type:"flex",altText:cut((lab?"【LAB】":"")+[title,studentName,preview||status].filter(Boolean).join("｜"),400),contents,fallbackText:fallback};
 // Presentation limits never trigger another delivery; transport handles fallback.
 return new TextEncoder().encode(JSON.stringify(contents)).length<29000?result:fallback;
}
function reviewButtons(code){
 const button=rating=>({type:"button",style:"secondary",height:"md",scaling:true,action:{type:"postback",label:`${rating} 星`,
  data:`lesson-review:${code}:${rating}`,inputOption:"openKeyboard",fillInText:`#個課評鑑 ${code} ${rating} `}});
 return [[1,2,3],[4,5]].map(values=>({type:"box",layout:"horizontal",spacing:"sm",contents:values.map(button)}));
}
function deadline(value){
 const timestamp=typeof value==="number"?value:Date.parse(value);
 return Number.isFinite(timestamp)?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(timestamp)):"";
}

export function buildPrivateLessonNoticeCard({notice={},entity={},appUrl="",reviewCode="",reviewExpiresAt="",fallbackText="",lab=false}={}){
 const event=Object.hasOwn(copy,notice.eventType)?notice.eventType:"completed",info=copy[event];
 const lessonDate=notice.lessonDate||entity.eventDate;
 const goals=(Array.isArray(notice.weeklyPracticeGoals)?notice.weeklyPracticeGoals:[]).slice(0,3).map(value=>cut(value,120)).filter(Boolean);
 const fields=[field(event==="rescheduled"?"新上課日期":"上課日期",date(lessonDate),{large:true}),field(event==="rescheduled"?"新上課時間":"上課時間",time(notice.startTime||entity.startTime,notice.endTime||entity.endTime),{large:true}),
  field("個課老師",cut(notice.teacherName||entity.teacherName||"個別課老師",120)),
  Number(notice.minutes||entity.minutes)>0?field("課程長度",Number(notice.minutes||entity.minutes)+" 分鐘"):null];
 if(event==="rescheduled"&&notice.previousDate)fields.push(field("原上課時間",date(notice.previousDate)+"\n"+time(notice.previousStartTime,notice.previousEndTime)));
 if(event==="cancelled"||event==="rescheduled")fields.push(field(event==="cancelled"?"停課原因":"改期原因",cut(notice.reason,1000)));
 if(event==="completed"){
  if(entity.actualAttendanceStatus==="late")fields.push(field("到課情形","遲到"));
  fields.push(field("本堂上課內容",cut(notice.lessonContent||entity.lessonContent,2000)));
  if(goals.length)fields.push(field("老師的課後練習建議",goals.map((goal,index)=>`${index+1}. ${goal}`).join("\n")));
 }
 if(event==="issue")fields.push(field("家長回報內容",cut(notice.note||entity.parentNote,1000)));
 if(event==="confirmed"&&Number.isInteger(Number(entity.teacherRating))&&Number(entity.teacherRating)>=1&&Number(entity.teacherRating)<=5){
  const rating=Number(entity.teacherRating);
  fields.push(field("家長給老師的教學評價","★".repeat(rating)+"☆".repeat(5-rating)+`（${rating}/5）`,{large:true}),field("家長評語",cut(entity.teacherReview,800)));
 }
 const code=/^[a-f0-9]{14}$/iu.test(clean(reviewCode))?clean(reviewCode).toUpperCase():"";
 const actions=[];let next=info.next;
 if(event==="completed"&&code){
  next="請先選星等，再於預填文字後加上評語，最後按傳送。\n送出後才會記錄評價並確認完課；未送出不會儲存。";
  actions.push(text("請選擇老師教學星等",{bold:true}),...reviewButtons(code));
  const due=deadline(reviewExpiresAt);if(due)actions.push(text("回覆期限："+due+"（台灣時間）",{size:"xs",color:palette.muted}));
  actions.push(text("不填星等或需回報問題，可到平台處理。",{size:"xs",color:palette.muted}));
 }
 actions.push(link(info.button,uri(appUrl,notice.schoolId)));
 return card({title:info.title,status:info.status,studentName:notice.studentName||entity.studentName||"學生",fields,next,actions,color:info.color,fallbackText,lab,
  preview:date(lessonDate)+" "+time(notice.startTime||entity.startTime,notice.endTime||entity.endTime)});
}

export function buildPrivatePracticeCard({studentName="",practiceDate="",minutes=0,goalText="",practiceNote="",lessonDate="",url="",fallbackText="",lab=false}={}){
 return card({title:"個課練習進度",status:"家長已回報課後練習",studentName:studentName||"學生",color:palette.green,lab,fallbackText,preview:date(practiceDate)+"｜練習 "+Math.max(0,Number(minutes)||0)+" 分鐘",
  fields:[field("練習日期",date(practiceDate),{large:true}),field("練習時間",Math.max(0,Number(minutes)||0)+" 分鐘",{large:true}),
   field("本次練習目標",cut(goalText,1000)),field("家長補充紀錄",cut(practiceNote,1000)),field("對應個課日期",date(lessonDate))],
  next:"這是家長回報的練習紀錄，不代表已熟練。",actions:[link("查看課後練習",uri(url))]});
}

export function buildPrivateReviewResponseCard({text:message="",receipt,appUrl="",schoolId="",lab=false}={}){
 const fallback=clean(message),success=receipt&&Number.isInteger(Number(receipt.rating))&&Number(receipt.rating)>=1&&Number(receipt.rating)<=5;
 if(success){
  const rating=Number(receipt.rating);
  return card({title:"已收到您的教學回饋",status:"本堂個課已確認完成",studentName:receipt.studentName||"",color:palette.green,lab,fallbackText:fallback,
   fields:[field("個課日期",date(receipt.date),{large:true}),...(receipt.startTime?[field("上課時間",time(receipt.startTime,receipt.endTime))]:[]),
    field("個課老師",receipt.teacherName?cut(receipt.teacherName,120):""),field("給老師的教學星等","★".repeat(rating)+"☆".repeat(5-rating)+`（${rating}/5）`,{large:true}),field("您的評語",cut(receipt.review,800))],
   next:"星等與評語已同步平台，不需再回網頁確認。",actions:[link("查看個課紀錄",uri(appUrl,schoolId))]});
 }
 const formatHint=/指令＋代碼|保留指令與代碼/u.test(fallback);
 const body=formatHint?"請回到這堂課的完課通知，先選星等，再於預填文字後加上您的實際評語，最後按傳送。\n請使用家長本人 LINE 操作。":cut(fallback||"請返回個課紀錄確認目前狀態。",2000);
 return card({title:formatHint?"請補上教學評語":"個課回覆提醒",status:"請依下方說明操作",color:palette.amber,lab,fallbackText:fallback,
  fields:[text(body)],next:"如需查看或處理這堂課，可回平台個課紀錄。",actions:[link("開啟個課紀錄",uri(appUrl,schoolId))]});
}
