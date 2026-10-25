import { app } from "@azure/functions";
import { getTenantContext, getStudentIdAliases, json } from "../lib/auth.js";
import { listStudentMaster, listTeacherDirectory, getTeacherProfile, listActivityRange, activityStudentId } from "../lib/storage.js";
import { followupTerm, buildPrivateLessonFollowup } from "../lib/privateLessonFollowup.js";

app.http("adminPrivateLessonFollowup",{
  methods:["GET"],authLevel:"anonymous",route:"admin-private-lesson-followup",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    const schoolYear=String(request.query.get("schoolYear")||""),semester=String(request.query.get("semester")||""),range=followupTerm(schoolYear,semester);
    if(!range)return json({error:"學年度或學期格式不正確"},400);
    const clock=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
    const part=key=>clock.find(x=>x.type===key)?.value||"",today=`${part("year")}-${part("month")}-${part("day")}`,nowTime=`${part("hour")}:${part("minute")}`;
    const [masters,directory,lessons]=await Promise.all([listStudentMaster("active",schoolId),listTeacherDirectory(schoolId),listActivityRange("privateLesson",schoolId,range.start,range.end)]);
    // Warm the tenant's alias cache once, then reuse it for the remaining students.
    if(masters.length)await getStudentIdAliases(String(masters[0].rowKey),schoolId);
    const [students,teachers]=await Promise.all([
      Promise.all(masters.map(async row=>({studentId:String(row.rowKey),aliases:await getStudentIdAliases(String(row.rowKey),schoolId)}))),
      Promise.all(directory.map(async row=>{const profile=await getTeacherProfile(row.rowKey,schoolId);return {email:String(row.rowKey),teacherName:row.teacherName,status:row.status,privateStudentIds:profile?.privateStudentIds}}))
    ]);
    return {...json({schoolYear,semester,start:range.start,end:range.end,asOf:today,items:buildPrivateLessonFollowup({students,teachers,lessons:lessons.map(row=>({...row,studentId:activityStudentId(row)})),...range,today,nowTime})}),headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}};
  }
});
