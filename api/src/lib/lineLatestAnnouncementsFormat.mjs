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

export function formatLineLatestAnnouncements({fromDate,groups=[],events=[]}={}){
  const normalizedGroups=[...new Set(groups.map(clean).filter(Boolean))];
  const groupLabel=normalizedGroups.length?normalizedGroups.map(group=>`${group.replace(/團$/u,"")}團`).join("、"):"相關團別";
  const rows=uniqueAnnouncementEvents(events).slice(0,5);
  if(!rows.length)return `📢 最新公告｜${groupLabel}\n\n目前沒有適用於學生團別的近期活動公告。\n\n查詢日期：${dateLabel(fromDate)}`;
  const body=rows.map(row=>{
    const date=clean(row.eventDate),end=clean(row.endDate),range=end&&end!==date?`${dateLabel(date)}～${dateLabel(end)}`:dateLabel(date);
    const location=clean(row.location),note=shortNote(row.note);
    return `🔔 ${clean(row.title)||"活動公告"}\n   ${range}｜${timeLabel(row)}${location?`\n   📍 ${location}`:""}${note?`\n   ${note}`:""}`;
  }).join("\n\n");
  return `📢 最新公告｜${groupLabel}\n\n${body}\n\n以上依活動日期排列，最多顯示最近 5 筆。`;
}
