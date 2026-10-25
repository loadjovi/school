import { getStudentIdAliases, json } from "./auth.js";
import { listStudentMaster, listTeacherDirectory, getTeacherProfile, listActivityRange, activityStudentId } from "./storage.js";
import { followupTerm, buildPrivateLessonFollowup } from "./privateLessonFollowup.js";

// Called only after teacherDirectory has checked the current tenant's admin role.
export async function privateLessonFollowupResponse(request,schoolId){
  const schoolYear=String(request.query.get("schoolYear")||""),semester=String(request.query.get("semester")||""),range=followupTerm(schoolYear,semester);
  if(!range)return json({error:"學年度或學期格式不正確"},400);
  const clock=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const part=key=>clock.find(x=>x.type===key)?.value||"",today=`${part("year")}-${part("month")}-${part("day")}`,nowTime=`${part("hour")}:${part("minute")}`;
  const [masters,directory,lessons]=await Promise.all([listStudentMaster("active",schoolId),listTeacherDirectory(schoolId),listActivityRange("privateLesson",schoolId,range.start,range.end)]);
  if(masters.length)await getStudentIdAliases(String(masters[0].rowKey),schoolId);
  const [students,teachers]=await Promise.all([
    Promise.all(masters.map(async row=>({studentId:String(row.rowKey),aliases:await getStudentIdAliases(String(row.rowKey),schoolId)}))),
    Promise.all(directory.map(async row=>{const profile=await getTeacherProfile(row.rowKey,schoolId);return {email:String(row.rowKey),teacherName:row.teacherName,status:row.status,privateStudentIds:profile?.privateStudentIds}}))
  ]);
  return {...json({schoolYear,semester,start:range.start,end:range.end,asOf:today,items:buildPrivateLessonFollowup({students,teachers,lessons:lessons.map(row=>({...row,studentId:activityStudentId(row)})),...range,today,nowTime})}),headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}};
}
