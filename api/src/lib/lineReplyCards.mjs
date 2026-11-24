import {formatLineTodayCourses, uniquePrivateLessons} from "./lineTodayCoursesFormat.mjs";
import {formatLineActivityCalendar, uniqueActivityEvents} from "./lineActivityCalendarFormat.mjs";
import {formatLineLatestAnnouncements, uniqueAnnouncementEvents} from "./lineLatestAnnouncementsFormat.mjs";

// This module only presents data already selected by the tenant reply service.
// It never fetches records, changes authorization, or creates links/actions.
const colors={today:"#3856A6",calendar:"#237A67",announcements:"#91651B"};
const names={today:"今日課程",calendar:"活動行事曆",announcements:"最新公告"};
const encoder=new TextEncoder();
const bytes=value=>encoder.encode(JSON.stringify(value)).length;
const records=value=>Array.isArray(value)?value.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)):[];
const clean=value=>["string","number"].includes(typeof value)?String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu,"").trim():"";
const cut=(value,max)=>{const chars=Array.from(clean(value));return chars.length>max?chars.slice(0,max-1).join("")+"…":chars.join("")};
const dateValue=value=>{
  const date=clean(value);
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(date))return "";
  const parsed=new Date(date+"T12:00:00Z");
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:"";
};
const day=value=>{
  const date=dateValue(value);
  return date?new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",weekday:"short"}).format(new Date(date+"T12:00:00+08:00")):"日期待確認";
};
const dateRange=row=>{
  const end=dateValue(row.endDate),start=dateValue(row.eventDate);
  return start&&end&&end!==start?day(start)+"～"+day(end):day(start);
};
const group=value=>{
  const raw=clean(value);
  if(raw==="ALL")return "全團";
  return [...new Set(raw.split(/[,、]/u).map(item=>item.trim().replace(/團$/u,"")).filter(Boolean))].map(item=>item+"團").join("、");
};
const scope=(input,student)=>input.schoolWide?"幹部｜全校":student?cut(student.name||"學生",60)+"｜"+(group(student.groupName)||"未分團"):
  [...new Set((Array.isArray(input.groups)?input.groups:[]).map(group).filter(Boolean))].join("、")||"相關團別";
const plainTimeDescriptions=new Set(["早自習","上午","下午","中午","傍晚","晚上","午休"]);
const validTime=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(clean(value));
const timeInfo=row=>{
  const range=[clean(row.startTime),clean(row.endTime)].filter(Boolean).join("–"),explicit=clean(row.timeLabel);
  if(plainTimeDescriptions.has(explicit)&&validTime(row.startTime)&&(!clean(row.endTime)||validTime(row.endTime))){
    return {value:range,note:explicit};
  }
  // Explicit notices can supersede placeholder numeric times, such as a
  // competition awaiting the organizer's schedule. Keep their source priority.
  return {value:cut(explicit||range||"時間待公告",180),note:""};
};
const status=row=>clean(row.effectiveStatus)==="cancelled"?"停課":({cancelled:"已取消",rescheduled:"已改期",leave:"已請假"})[clean(row.status)]||"";
const clock=row=>{
  const time=clean(row.startTime),match=/^(\d{2}):(\d{2})$/u.exec(time);
  return match&&Number(match[1])<24&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):1440;
};

function text(value,{size="sm",color="#17324D",weight="regular",margin}={}){
  return {type:"text",text:clean(value)||"—",size,color,weight,wrap:true,scaling:true,...(margin?{margin}:{})};
}
function field(label,value,{prominent=false,danger=false}={}){
  if(!clean(value))return null;
  return {type:"box",layout:"vertical",spacing:"xs",margin:"md",contents:[
    text(label,{size:"xs",color:"#5C6B78"}),
    text(value,{size:prominent?"lg":"sm",weight:prominent||danger?"bold":"regular",color:danger?"#A42F28":"#17324D"})
  ]};
}
function bubble(kind,entry,index,shown,total,{period="",unit="筆",footer=""}={}){
  const title=cut(entry.title,140),headerDate=kind==="calendar"?(entry.date||period):period;
  const contents=[text(title,{size:"xl",weight:"bold"})];
  if(kind==="announcements"&&entry.note)contents.push(field("重要提醒",cut(entry.note,1000)));
  if(entry.date&&kind!=="calendar")contents.push(field("日期",entry.date));
  if(entry.time)contents.push(field("時間",entry.time,{prominent:true}));
  if(entry.timeNote)contents.push(field("時間說明",entry.timeNote));
  if(entry.group)contents.push(field("團別",cut(entry.group,100)));
  if(entry.teacher)contents.push(field("老師",cut(entry.teacher,100)));
  if(entry.location)contents.push(field("地點",cut(entry.location,300)));
  if(entry.status)contents.push(field("狀態",cut(entry.status,100),{danger:true}));
  if(kind!=="announcements"&&entry.note)contents.push(field("提醒",cut(entry.note,kind==="today"?240:300)));
  const count=total?`第 ${index+1} / ${shown} 張 · 顯示 ${shown} / ${total} ${unit}`:"";
  return {type:"bubble",size:"mega",header:{type:"box",layout:"vertical",spacing:"xs",paddingAll:"16px",backgroundColor:colors[kind],contents:[
    text(names[kind],{size:"md",weight:"bold",color:"#FFFFFF"}),
    ...(headerDate?[text(cut(headerDate,120),{size:"lg",weight:"bold",color:"#FFFFFF"})]:[]),
    text(cut(entry.scope,100),{size:"sm",color:"#FFFFFF"})
  ]},body:{type:"box",layout:"vertical",paddingAll:"16px",backgroundColor:"#FFFFFF",contents:contents.filter(Boolean)},
  footer:{type:"box",layout:"vertical",spacing:"sm",paddingAll:"16px",backgroundColor:"#FFFFFF",contents:[
    {type:"separator",color:"#D9E1E8"},
    ...(count?[text(count,{size:"xs",color:"#5C6B78"})]:[]),
    text((shown<total?"其餘內容請至平台查看。\n":"")+footer,{size:"xs",color:"#5C6B78"})
  ]}};
}

function fallback(formatter,input,summary){
  let value;
  try{value=cut(formatter(input),4000)}catch{value=summary}
  // Keep the internal fallback bounded too; the transport removes this field
  // before sending Flex and can use it if LINE refuses the card payload.
  while(encoder.encode(value).length>8000)value=cut(value,Math.max(1,Array.from(value).length-100));
  return value;
}
function message(kind,input,entries,{cap,period="",empty,unit="筆",footer="",formatter,scopeLabel=""}={}){
  const total=entries.length,label=cut(scopeLabel||scope(input),100),summary=names[kind]+(period?"｜"+period:"")+"｜"+label+"｜"+(total?`共 ${total} ${unit}`:empty);
  const preview=entries.slice(0,2).map(entry=>cut(entry.title,50)+(entry.time?" "+cut(entry.time,50):"")).join("；");
  const fallbackText=fallback(formatter,input,summary);
  let shown=Math.min(total,cap);
  let contents;
  const build=()=>{
    const cards=shown?entries.slice(0,shown).map((entry,index)=>bubble(kind,entry,index,shown,total,{period,unit,footer})):
      [bubble(kind,{title:empty,scope:label},0,0,0,{period,unit,footer})];
    return cards.length===1?cards[0]:{type:"carousel",contents:cards};
  };
  contents=build();
  let result={type:"flex",altText:cut(summary+(preview?"；"+preview:""),400),contents,fallbackText};
  // Field caps keep a single bubble well below 30 KB. A pathological input
  // can still make many long cards exceed the reply budget: show fewer cards
  // with an explicit displayed/total count instead of silently clipping rows.
  while(shown>1&&(bytes(result)>47000||(contents.contents||[contents]).some(card=>bytes(card)>29000))){
    shown--;contents=build();result={...result,contents};
  }
  return result;
}

export function buildTodayCourseCards(input={}){
  const normalized={...input,students:records(input.students).map(item=>({...item,student:item.student&&typeof item.student==="object"?item.student:{},
    schedules:records(item.schedules),training:records(item.training),privateLessons:input.schoolWide?[]:uniquePrivateLessons(records(item.privateLessons))}))};
  const entries=[],emptyStudents=[];
  for(const item of normalized.students){
    const studentScope=scope(normalized,item.student),start=entries.length;
    const add=(row,title,kind)=>{
      const time=timeInfo(row),cancelled=clean(row.effectiveStatus)==="cancelled",reason=cancelled?clean(row.exception?.reason):"";
      entries.push({scope:studentScope,title,time:time.value,timeNote:time.note,location:clean(row.location),
        group:normalized.schoolWide?group(row.groupName||row.targetGroups):"",teacher:kind==="private"?clean(row.teacherName||row.teacher):"",
        status:status(row),note:reason||clean(row.note),order:clock(row),sequence:entries.length});
    };
    for(const row of item.schedules)add(row,clean(row.courseName)||"團體課","schedule");
    for(const row of item.training)add(row,clean(row.title)||"加練／訓練","training");
    for(const row of item.privateLessons)add(row,"個別課","private");
    if(entries.length===start&&!normalized.schoolWide)emptyStudents.push(cut(item.student.name||"學生",60));
  }
  entries.sort((a,b)=>a.order-b.order||a.sequence-b.sequence);
  const footer="依上課時間排序，資料依平台即時整理。"+(entries.length&&emptyStudents.length?"\n今日無課程："+cut(emptyStudents.join("、"),100):"");
  const label=normalized.schoolWide?"幹部｜全校":normalized.students.map(item=>scope(normalized,item.student)).join("、")||"家長課程";
  return message("today",{...normalized,groups:normalized.schoolWide?[]:normalized.students.map(item=>item.student.groupName)},entries,
    {cap:12,period:day(normalized.date),unit:"堂",empty:"今天沒有已安排的課程",footer,scopeLabel:label,
      formatter:args=>formatLineTodayCourses(args)});
}

function eventEntries(input,unique){
  return unique(records(input.events)).map(row=>{
    const time=timeInfo(row);
    return {title:clean(row.title)||"團隊活動",date:dateRange(row),time:time.value,timeNote:time.note,
      scope:scope(input),group:input.schoolWide?group(row.targetGroups):"",location:clean(row.location),status:status(row),note:clean(row.note)};
  });
}
export function buildActivityCalendarCards(input={}){
  const normalized={...input,events:records(input.events),groups:Array.isArray(input.groups)?input.groups:[]},entries=eventEntries(normalized,uniqueActivityEvents);
  return message("calendar",normalized,entries,{cap:8,period:day(input.fromDate)+"～"+day(input.toDate),
    empty:"未來 30 天沒有已安排的活動",footer:"查詢區間："+day(input.fromDate)+"～"+day(input.toDate)+"\n依日期排列，查詢未來 30 天活動。",formatter:formatLineActivityCalendar});
}

export function buildLatestAnnouncementCards(input={}){
  const normalized={...input,events:records(input.events),groups:Array.isArray(input.groups)?input.groups:[]},entries=eventEntries(normalized,uniqueAnnouncementEvents);
  return message("announcements",normalized,entries,{cap:5,period:"重要提醒與異動",empty:"目前沒有新的重要通知或課程異動",
    footer:"僅列重要提醒與異動；一般活動請看「活動行事曆」。",formatter:formatLineLatestAnnouncements});
}
