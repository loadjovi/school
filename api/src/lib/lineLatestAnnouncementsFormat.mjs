const clean=value=>String(value||"").trim();

export function isLatestAnnouncementsCommand(text){
  return /^#?最新公告$/u.test(clean(text).replaceAll(" ",""));
}

const dateLabel=date=>new Intl.DateTimeFormat("zh-TW",{
  timeZone:"Asia/Taipei",month:"numeric",day:"numeric",weekday:"short"
}).format(new Date(`${date}T12:00:00+08:00`));

const timeLabel=row=>{
  const explicit=clean(row.timeLabel),start=clean(row.startTime),end=clean(row.endTime);
  return explicit||[start,end].filter(Boolean).join("–")||"時間待公告";
};

const shortNote=(value,max=90)=>{
  const text=clean(value).replace(/\s+/gu," ");
  return text.length>max?`${text.slice(0,max)}…`:text;
};

const announcementPattern=/(公告|通知|提醒|異動|調整|改期|延期|取消|停課|補課|集合|報到|服裝|攜帶|繳費|匯款|截止|請假|志工|重要|注意)/u;

export function isImportantAnnouncement(row={}){
  return announcementPattern.test([clean(row.title),clean(row.note),clean(row.timeLabel)].join(" "));
}

export function uniqueAnnouncementEvents(rows=[]){
  const unique=new Map();
  for(const row of rows){
    const key=[clean(row.schoolId),clean(row.eventDate),clean(row.title),clean(row.startTime)].join("|");
    if(!unique.has(key))unique.set(key,row);
  }
  return [...unique.values()].sort((a,b)=>
    clean(a.eventDate).localeCompare(clean(b.eventDate))||
    clean(a.startTime).localeCompare(clean(b.startTime))||
    clean(a.title).localeCompare(clean(b.title),"zh-Hant")
  );
}

export function formatLineLatestAnnouncements({fromDate,groups=[],events=[],schoolWide=false}={}){
  const normalizedGroups=[...new Set(groups.map(clean).filter(Boolean))];
  const groupLabel=schoolWide?"幹部｜全校":normalizedGroups.length?normalizedGroups.map(group=>`${group.replace(/團$/u,"")}團`).join("、"):"相關團別";
  const rows=uniqueAnnouncementEvents(events).slice(0,5);
  if(!rows.length)return `📢 最新公告｜${groupLabel}\n\n目前沒有新的重要通知或課程異動。\n\n一般活動日期請點選「活動行事曆」。`;
  const body=rows.map(row=>{
    const date=clean(row.eventDate),end=clean(row.endDate),range=end&&end!==date?`${dateLabel(date)}～${dateLabel(end)}`:dateLabel(date);
    const location=clean(row.location),note=shortNote(row.note);
    return `🔔 ${clean(row.title)||"重要通知"}\n   ${note||"請留意本項安排。"}\n   日期：${range}${clean(row.startTime)||clean(row.timeLabel)?`｜${timeLabel(row)}`:""}${location?`\n   📍 ${location}`:""}`;
  }).join("\n\n");
  return `📢 最新公告｜${groupLabel}\n\n${body}\n\n僅顯示重要提醒與異動；完整活動請查看「活動行事曆」。`;
}
