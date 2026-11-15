const clean=value=>String(value||"").trim();
const timeRange=row=>[clean(row.startTime),clean(row.endTime)].filter(Boolean).join("–")||"時間待確認";
const statusLabel=status=>({cancelled:"已取消",rescheduled:"已改期",leave:"已請假"})[clean(status)]||"";

export function isTodayCoursesCommand(text){
  return /^#?今日課程$/u.test(clean(text).replaceAll(" ",""));
}

export function uniquePrivateLessons(rows=[]){
  const latest=new Map();
  for(const row of rows){
    const key=clean(row.sessionId)||clean(row.rowKey)||[clean(row.eventDate),clean(row.startTime),clean(row.teacher)].join("|");
    const old=latest.get(key),stamp=`${clean(row.updatedAt||row.createdAt)}|${clean(row.rowKey)}`;
    const oldStamp=old?`${clean(old.updatedAt||old.createdAt)}|${clean(old.rowKey)}`:"";
    if(!old||stamp>=oldStamp)latest.set(key,row);
  }
  return [...latest.values()].sort((a,b)=>clean(a.startTime).localeCompare(clean(b.startTime)));
}

function courseLine(icon,title,row,note=""){
  const location=clean(row.location),state=note||statusLabel(row.status);
  return `${icon} ${title}\n   ${timeRange(row)}${location?`｜${location}`:""}${state?`｜${state}`:""}`;
}

export function formatLineTodayCourses({date,students=[]}={}){
  const formatted=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",weekday:"short"}).format(new Date(`${date}T12:00:00+08:00`));
  const sections=students.map(item=>{
    const student=item.student||{},rows=[];
    for(const row of item.schedules||[]){
      const cancelled=clean(row.effectiveStatus)==="cancelled";
      const note=cancelled?`停課${row.exception?.reason?`：${clean(row.exception.reason)}`:""}`:"";
      rows.push(courseLine(row.courseType==="section"?"🎼":"🎻",clean(row.courseName)||"團體課",row,note));
    }
    for(const row of item.training||[])rows.push(courseLine("🏆",clean(row.title)||"加練／訓練",row));
    for(const row of item.privateLessons||[]){
      const teacher=clean(row.teacherName)||clean(row.teacher),status=statusLabel(row.status);
      rows.push(courseLine("👤",`個別課${teacher?`｜${teacher}`:""}`,row,status));
    }
    const title=`【${clean(student.name)||"學生"}｜${clean(student.groupName)||"未分團"}團】`;
    return `${title}\n${rows.length?rows.join("\n"):"✅ 今天沒有已安排的課程"}`;
  });
  return `📅 今日課程｜${formatted}\n\n${sections.join("\n\n")}\n\n資料依平台目前課表、訓練行事曆與個課預約即時整理。`;
}
