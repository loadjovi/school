import {app} from "@azure/functions";
import {getTenantContext,ensurePrivateAccess,getStudentIdAliases,json} from "../lib/auth.js";
import {table,tenantStudentPartition,listByStudent} from "../lib/storage.js";
import {isPublishedLesson} from "../lib/musicLearningGoals.mjs";
import {privatePracticeProgress} from "../lib/privatePracticeProgress.mjs";

app.http("privateLessonPractice",{methods:["GET"],authLevel:"anonymous",route:"private-lesson-practice",handler:async request=>{
 const context=await getTenantContext(request);if(context.error)return context.error;
 const {access,schoolId}=context;
 if(access.role!=="admin"&&!access.capabilities?.private)return json({error:"僅個課老師可查看課後練習"},403);
 const studentId=String(request.query.get("studentId")||""),lessonId=String(request.query.get("lessonId")||"");
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(studentId)||!/^[a-zA-Z0-9_-]{1,180}$/.test(lessonId))return json({error:"請指定學生與個課紀錄"},400);
 try{
  const aliases=await getStudentIdAliases(studentId,schoolId);let lesson;
  if(!ensurePrivateAccess(access,aliases[0]||studentId))return json({error:"Forbidden"},403);
  for(const id of aliases){try{lesson=await table("tenantPrivateLesson").getEntity(tenantStudentPartition(schoolId,id),lessonId);break}catch(error){if(error.statusCode!==404)throw error}}
  if(!lesson||access.role!=="admin"&&String(lesson.teacher||"").toLowerCase()!==String(access.email||"").toLowerCase())return json({error:"找不到此老師的個課紀錄"},404);
  if(!isPublishedLesson(lesson))return json({error:"此堂課尚未發布練習建議"},409);
  const end=new Date(Date.parse(lesson.eventDate+"T00:00:00Z")+14*86400000).toISOString().slice(0,10);
  const rows=(await Promise.all(aliases.map(id=>listByStudent("practice",id,lesson.eventDate,end,schoolId)))).flat();
  return json(privatePracticeProgress(lesson,rows));
 }catch(error){console.error("privateLessonPractice",error);return json({error:"課後練習暫時無法讀取，請重新整理"},500)}
}});
