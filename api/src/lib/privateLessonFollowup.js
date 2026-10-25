// Read-only follow-up metadata. Official scores remain in parentSemesterAttendance.
const clean=value=>String(value??"").trim();
const email=value=>clean(value).toLowerCase();
const completedStatuses=new Set(["teacher_completed","present","late"]);
function ids(value){
  if(Array.isArray(value))return value.map(clean).filter(Boolean);
  try{const parsed=JSON.parse(String(value||"[]"));return Array.isArray(parsed)?parsed.map(clean).filter(Boolean):[]}catch{return []}
}
export function followupTerm(schoolYear,semester){
  if(!/^\d{3}$/.test(clean(schoolYear))||Number(schoolYear)<100||Number(schoolYear)>140||!["1","2"].includes(clean(semester)))return null;
  const year=Number(schoolYear)+1911+(String(semester)==="2"?1:0);
  return String(semester)==="1"?{start:`${year}-10-01`,end:`${year}-12-31`}:{start:`${year}-02-01`,end:`${year}-05-31`};
}
export function buildPrivateLessonFollowup({students,teachers,lessons,start,end,today,nowTime}){
  const aliasToStudent=new Map(),items=new Map();
  for(const student of students){
    const studentId=clean(student.studentId);
    for(const id of new Set([studentId,...ids(student.aliases)]))aliasToStudent.set(id,studentId);
    items.set(studentId,{studentId,assignedTeachers:[],recordTeachers:[],completed:0,awaitingParent:0,teacherPending:0,upcoming:0,issues:0,cancelled:0,other:0,recordCount:0,lastLessonDate:"",lastCompletedDate:""});
  }
  const directory=new Map(teachers.map(t=>[email(t.email),t]));
  for(const teacher of teachers){
    if(teacher.status==="inactive")continue;
    const targetIds=new Set(ids(teacher.privateStudentIds).map(id=>aliasToStudent.get(id)).filter(Boolean));
    for(const id of targetIds)items.get(id).assignedTeachers.push({email:email(teacher.email),name:clean(teacher.teacherName)||email(teacher.email)});
  }
  const latest=new Map();
  for(const row of lessons){
    const studentId=aliasToStudent.get(clean(row.studentId)),date=clean(row.eventDate);
    if(!studentId||date<start||date>end)continue;
    // Match the semester score API's alias/session deduplication.
    const key=[studentId,date,clean(row.classType)||"privateLesson",clean(row.sessionId)||clean(row.rowKey)].join("|");
    const old=latest.get(key),stamp=clean(row.createdAt)+"|"+clean(row.rowKey);
    if(!old||stamp>=clean(old.createdAt)+"|"+clean(old.rowKey))latest.set(key,{...row,canonicalStudentId:studentId});
  }
  for(const row of latest.values()){
    const item=items.get(row.canonicalStudentId),date=clean(row.eventDate),status=clean(row.status),key=email(row.teacher),teacher=directory.get(key);
    // Future bookings are visible for follow-up, but never counted as completed.
    if(date>today&&status!=="scheduled")continue;
    item.recordCount++;
    if(date<=today&&date>item.lastLessonDate)item.lastLessonDate=date;
    if(key&&!item.recordTeachers.some(t=>t.email===key))item.recordTeachers.push({email:key,name:clean(teacher?.teacherName)||clean(row.teacherName)||key,inactive:teacher?.status==="inactive"});
    if(status==="cancelled"){item.cancelled++;continue}
    if(status==="completion_issue"||row.parentConfirmation==="issue"){item.issues++;continue}
    if(status==="scheduled"){
      const time=clean(row.endTime),ended=date<today||date===today&&/^\d{2}:\d{2}$/.test(time)&&time<=nowTime;
      if(ended)item.teacherPending++;else item.upcoming++;
      continue;
    }
    if(completedStatuses.has(status)){
      item.completed++;
      if(date>item.lastCompletedDate)item.lastCompletedDate=date;
      if(status==="teacher_completed"||row.parentConfirmation==="pending")item.awaitingParent++;
    }else item.other++;
  }
  for(const item of items.values()){
    item.assignedTeachers.sort((a,b)=>a.name.localeCompare(b.name,"zh-Hant"));
    item.recordTeachers.sort((a,b)=>a.name.localeCompare(b.name,"zh-Hant"));
  }
  return [...items.values()];
}
