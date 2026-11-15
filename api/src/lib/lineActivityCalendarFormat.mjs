const clean=value=>String(value||"").trim();

export function isActivityCalendarCommand(text){
  return /^#?活動行事曆$/u.test(clean(text).replaceAll(" ",""));
}

const dateLabel=date=>new Intl.DateTimeFormat("zh-TW",{
  timeZone:"Asia/Taipei",month:"numeric",day:"numeric",weekday:"short"
}).format(new Date(`${date}T12:00:00+08:00`));

const timeLabel=row=>clean(row.timeLabel)||[clean(row.startTime),clean(row.endTime)].filter(Boolean).join("–")||"時間待公告";

export function uniqueActivityEvents(rows=[]){
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

export function formatLineActivityCalendar({fromDate,toDate,groups=[],events=[],schoolWide=false}={}){
  const normalizedGroups=[...new Set(groups.map(clean).filter(Boolean))];
  const groupLabel=schoolWide?"幹部｜全校":normalizedGroups.length?normalizedGroups.map(group=>`${group.replace(/團$/u,"")}團`).join("、"):"相關團別";
  const rows=uniqueActivityEvents(events).slice(0,8);
  if(!rows.length)return `📅 活動行事曆｜${groupLabel}\n\n未來 30 天沒有${schoolWide?"安排":"適用於學生團別的"}活動、加練、比賽或演出。\n\n查詢區間：${dateLabel(fromDate)}～${dateLabel(toDate)}`;
  const body=rows.map(row=>{
    const date=clean(row.eventDate),end=clean(row.endDate),range=end&&end!==date?`${dateLabel(date)}～${dateLabel(end)}`:dateLabel(date);
    const location=clean(row.location);
    const group=schoolWide&&clean(row.targetGroups)?`｜${clean(row.targetGroups)==="ALL"?"全團":clean(row.targetGroups)}`:"";
    return `• ${range}｜${timeLabel(row)}\n  ${clean(row.title)||"團隊活動"}${group}${location?`\n  📍 ${location}`:""}`;
  }).join("\n\n");
  return `📅 活動行事曆｜${groupLabel}\n${dateLabel(fromDate)}～${dateLabel(toDate)}\n\n${body}\n\n以上依日期排列，最多顯示 8 筆。`;
}
