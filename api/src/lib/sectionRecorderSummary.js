// Each student keeps only their latest attendance state for a section on a day.
// A merged section retains the student's original section in storage, while
// mergeTargetSection identifies the class where attendance was actually taken.
export function sectionRecorderSummary(rows,teacherNames=new Map(),students=new Map()){
  const latest=new Map();
  for(const row of rows||[]){
    const date=String(row.eventDate||""),group=String(row.groupName||""),section=String(row.section||"");
    const student=String(row.studentId||row.rawStudentId||row.rowKey||"");
    if(!date||!student)continue;
    const key=[date,group,section,student].join("|");
    const stamp=`${String(row.createdAt||"")}|${String(row.rowKey||"")}`;
    const old=latest.get(key);
    if(!old||stamp>=old.stamp)latest.set(key,{row,stamp});
  }
  const classes=new Map();
  for(const {row} of latest.values()){
    const status=String(row.status||"");
    if(!["present","late","leave","absent"].includes(status))continue;
    const eventDate=String(row.eventDate||""),groupName=String(row.groupName||""),section=String(row.mergeTargetSection||row.section||"待確認");
    const key=[eventDate,groupName,section].join("|");
    if(!classes.has(key))classes.set(key,{eventDate,groupName,section,mergedSections:[],recorded:0,present:0,late:0,leave:0,absent:0,lateStudents:[],absentStudents:[],lastSavedAt:"",recorders:[]});
    const item=classes.get(key),source=String(row.section||"");
    if(row.mergeTargetSection&&source&&source!==section&&!item.mergedSections.includes(source))item.mergedSections.push(source);
    item.recorded++;item[status]++;
    if(status==="late"||status==="absent"){
      const studentId=String(row.studentId||row.rawStudentId||""),student=students.get(studentId);
      item[status==="late"?"lateStudents":"absentStudents"].push({studentId,name:String(student?.name||row.studentName||`學生 ${studentId}`),sourceSection:source});
    }
    item.lastSavedAt=String(row.createdAt||"")>item.lastSavedAt?String(row.createdAt||""):item.lastSavedAt;
    const email=String(row.teacher||"").trim().toLowerCase(),storedName=String(row.teacherName||"").trim();
    const directoryName=String(teacherNames.get(email)||"");
    const name=directoryName&&directoryName!==email?directoryName:storedName||email||"未記錄點名者";
    const role=String(row.actorRole||"teacher")==="admin"?"admin":"teacher";
    const recorderKey=`${role}|${email||name}`;
    let recorder=item.recorders.find(x=>x.key===recorderKey);
    if(!recorder){recorder={key:recorderKey,email,name,role,count:0};item.recorders.push(recorder)}
    recorder.count++;
  }
  return [...classes.values()].map(item=>({...item,mergedSections:item.mergedSections.sort((a,b)=>a.localeCompare(b,"zh-Hant")),lateStudents:item.lateStudents.sort((a,b)=>a.name.localeCompare(b.name,"zh-Hant")),absentStudents:item.absentStudents.sort((a,b)=>a.name.localeCompare(b.name,"zh-Hant")),recorders:item.recorders.map(({key,...r})=>r).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"zh-Hant"))})).sort((a,b)=>b.eventDate.localeCompare(a.eventDate)||a.groupName.localeCompare(b.groupName,"zh-Hant")||a.section.localeCompare(b.section,"zh-Hant"));
}
