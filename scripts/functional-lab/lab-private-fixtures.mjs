// Fictional examples use reserved, non-deliverable email domains. They grant
// no access to any real teacher or parent account and never send notifications.
export const privateFixtureCases=[
  {studentId:"990101",name:"測試甲同學",teacher:0,caseLabel:"A 團｜已綁老師、完成評分與家長評論"},
  {studentId:"990102",name:"測試乙同學",teacher:1,caseLabel:"A 團｜已綁老師、尚無個課紀錄"},
  {studentId:"990103",name:"測試丙同學",teacher:null,caseLabel:"A 團｜未綁老師、待補資料"},
  {studentId:"990104",name:"測試丁同學",teacher:0,caseLabel:"B 團｜個課已改期、尚未上課"},
  {studentId:"990105",name:"測試戊同學",teacher:1,caseLabel:"儲備團｜老師已完成、待家長確認"},
  {studentId:"990106",name:"測試己同學",teacher:1,caseLabel:"儲備團｜課程已過、待老師完成"}
];
export async function seedPrivateExamples({table,addIfMissing,schoolId,result}){
  const masters=await table(process.env.TENANT_STUDENT_MASTER_TABLE||"TenantStudentMaster");
  const directory=await table(process.env.TENANT_TEACHER_DIRECTORY_TABLE||"TenantTeacherDirectory");
  const profiles=await table(process.env.TENANT_TEACHER_PROFILE_TABLE||"TenantTeacherProfile");
  const lessons=await table(process.env.TENANT_PRIVATE_TABLE||"TenantPrivateLesson");
  const teachers=[{email:"lab.private.one@example.invalid",name:"LAB 個課老師甲"},{email:"lab.private.two@example.invalid",name:"LAB 個課老師乙"}];
  const now=new Date().toISOString(),available=[];
  for(const item of privateFixtureCases){
    const row=await masters.getEntity(schoolId,item.studentId).catch(e=>{if(e.statusCode===404)return null;throw e});
    if(row?.studentName===item.name&&row.updatedBy==="SOP_LAB_FIXTURE")available.push(item);
  }
  if(!available.length)throw Object.assign(Error("請先建立六位 SOP 虛構學生，再補齊個課案例"),{statusCode:400});
  const put=async(client,row)=>{const status=await addIfMissing(client,row);result[status==="created"?"created":"existing"]++};
  for(const [index,t] of teachers.entries()){
    await put(directory,{partitionKey:schoolId,rowKey:t.email,schoolId,teacherEmail:t.email,teacherName:t.name,status:"active",privateOnly:true,createdAt:now,updatedAt:now,updatedBy:"SOP_LAB_FIXTURE",lastLoginAt:""});
    await put(profiles,{partitionKey:schoolId,rowKey:t.email,schoolId,teacherEmail:t.email,displayName:t.name,sectionAssignments:"[]",ensembleGroups:"[]",comprehensiveEnabled:false,
      privateStudentIds:JSON.stringify(available.filter(x=>x.teacher===index).map(x=>x.studentId)),createdAt:now,updatedAt:now,updatedBy:"SOP_LAB_FIXTURE"});
  }
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part=key=>parts.find(x=>x.type===key).value,today=`${part("year")}-${part("month")}-${part("day")}`;
  const shift=days=>new Date(Date.parse(today+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
  const cases=[
    {id:"990101",date:shift(-7),status:"present",confirmation:"confirmed",rating:4},
    {id:"990104",date:shift(7),status:"scheduled",confirmation:"not_required",rescheduled:true},
    {id:"990105",date:shift(-3),status:"teacher_completed",confirmation:"pending"},
    {id:"990106",date:shift(-2),status:"scheduled",confirmation:"not_required"}
  ];
  for(const c of cases){
    const student=available.find(x=>x.studentId===c.id);if(!student)continue;
    const teacher=teachers[student.teacher];
    // Existing bindings are authoritative. Do not add example lessons if a
    // cadre has already changed this teacher's original fixture assignment.
    const profile=await profiles.getEntity(schoolId,teacher.email);
    let ids=[];try{const parsed=JSON.parse(profile.privateStudentIds||"[]");if(Array.isArray(parsed))ids=parsed}catch{}
    if(!ids.includes(c.id))continue;
    const row={partitionKey:`${schoolId}|student|${c.id}`,rowKey:"sop_private_"+c.id,schoolId,studentId:c.id,studentName:student.name,
      eventDate:c.date,startTime:"16:00",endTime:"17:00",minutes:60,classType:"privateLesson",teacher:teacher.email,teacherName:teacher.name,
      status:c.status,parentConfirmation:c.confirmation,lessonContent:"LAB 虛構案例：音階與樂曲練習",studentPerformanceRating:c.rating||0,
      studentPerformanceRatedAt:c.rating?now:"",studentPerformanceRatedBy:c.rating?teacher.email:"",createdAt:now,updatedAt:now,
      scheduledAt:now,scheduledBy:"SOP_LAB_FIXTURE",emailNotificationStatus:"disabled",fixtureId:"sop_private_"+c.id};
    if(c.status!=="scheduled"){row.completedAt=now;row.completedBy=teacher.email}
    if(c.confirmation==="confirmed")Object.assign(row,{parentConfirmedAt:now,parentConfirmedBy:"lab.parent@example.invalid",teacherRating:5,teacherReview:"LAB 示範評論：老師有清楚說明練習方法。",teacherRatedAt:now,teacherRatedBy:"lab.parent@example.invalid"});
    if(c.rescheduled)Object.assign(row,{rescheduleCount:1,rescheduledAt:now,rescheduledBy:"SOP_LAB_FIXTURE",rescheduleReason:"LAB 示範改期",scheduleHistory:JSON.stringify([{lessonDate:shift(5),startTime:"16:00",endTime:"17:00",at:now,by:"SOP_LAB_FIXTURE"}])});
    await put(lessons,row);
  }
  result.privateCases=available.map(x=>({studentId:x.studentId,name:x.name,caseLabel:x.caseLabel}));
  result.privateExamples="added_missing_only";
}
