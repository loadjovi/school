import {getLineAccountBindingsByUserId} from "./lineAccountBinding.js";
import {getMappedStudentsByEmail,listByStudent} from "./storage.js";
import {resolveSchoolCourses} from "../functions/schoolSchedule.js";
import {calendarEventsForStudent} from "../functions/calendarEvents.js";
import {isTrainingEventType} from "./trainingEventTypes.js";
import {formatLineTodayCourses,uniquePrivateLessons} from "./lineTodayCoursesFormat.mjs";

export {formatLineTodayCourses,isTodayCoursesCommand} from "./lineTodayCoursesFormat.mjs";

export async function lineTodayCoursesReply(lineUserId,{now=new Date()}={}){
  const bindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:false});
  if(!bindings.length)return "目前 LINE 尚未連結平台帳號，請先點選「開啟／綁定平台」完成綁定。";
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const identities=[];
  for(const binding of bindings){
    const students=await getMappedStudentsByEmail(binding.parentEmail,binding.schoolId);
    for(const student of students)identities.push({schoolId:binding.schoolId,student});
  }
  if(!identities.length)return "目前帳號沒有已核准並綁定的學生，因此無法查詢今日課程。";
  const items=await Promise.all(identities.map(async({schoolId,student})=>{
    const [schedules,events,privateLessons]=await Promise.all([
      resolveSchoolCourses(schoolId,date,student),
      calendarEventsForStudent(schoolId,date,date,student),
      listByStudent("privateLesson",student.studentId,date,date,schoolId)
    ]);
    return {
      student,
      schedules,
      training:events.filter(row=>isTrainingEventType(row.eventType)),
      privateLessons:uniquePrivateLessons(privateLessons)
    };
  }));
  return formatLineTodayCourses({date,students:items});
}
