import {getStudentIdAliases} from "./auth.js";
import {table,tenantStudentPartition,getTeacherDirectory,getTeacherProfile,getStudentMaster} from "./storage.js";
import {isPublishedLesson,withinGoalWindow} from "./musicLearningGoals.mjs";
import {deliverLabNotice,labNoticeLineResult,labNoticeUrl,lineFirstLabEnabled} from "./labNoticeDelivery.mjs";
import {buildPrivatePracticeCard} from "./privateLessonLineCards.mjs";

const get=async(client,partition,id)=>{try{return await client.getEntity(partition,id)}catch(error){if(error.statusCode===404)return null;throw error}};
async function noticeContext(schoolId,practice){
 const stored=await get(table("tenantPractice"),practice.partitionKey,practice.rowKey);
 if(!stored?.weeklyGoalLessonId||!stored.weeklyGoalText||stored.schoolId&&stored.schoolId!==schoolId)return null;
 const aliases=await getStudentIdAliases(stored.studentId,schoolId);let lesson;
 if(!aliases.some(id=>stored.partitionKey===tenantStudentPartition(schoolId,id)))return null;
 for(const id of aliases){lesson=await get(table("tenantPrivateLesson"),tenantStudentPartition(schoolId,id),stored.weeklyGoalLessonId);if(lesson)break}
 if(!lesson||!isPublishedLesson(lesson)||!withinGoalWindow(lesson.eventDate,stored.eventDate))return null;
 const teacher=String(lesson.teacher||"").trim().toLowerCase();
 if(!teacher||stored.weeklyGoalTeacher&&stored.weeklyGoalTeacher!==teacher)return null;
 const [directory,profile,student]=await Promise.all([getTeacherDirectory(teacher,schoolId),getTeacherProfile(teacher,schoolId),getStudentMaster(aliases[0]||stored.studentId,schoolId)]);
 let ids=[];try{ids=Array.isArray(profile?.privateStudentIds)?profile.privateStudentIds:JSON.parse(profile?.privateStudentIds||"[]")}catch{}
 if(directory?.status!=="active"||!Array.isArray(ids)||!ids.some(id=>aliases.includes(String(id)))||!student||student.status==="inactive")return null;
 return {stored,lesson,teacher,student};
}
export async function notifyPrivatePractice(schoolId,practice){
 if(!lineFirstLabEnabled())return {status:"disabled"};
 try{
  const context=await noticeContext(schoolId,practice);if(!context)return {status:"ineligible"};
  const {stored,lesson,teacher,student}=context,appUrl=labNoticeUrl(schoolId);if(!appUrl)return {status:"not_configured"};const url=new URL(appUrl);url.searchParams.set("practiceLesson",lesson.rowKey);url.searchParams.set("practiceStudent",stored.studentId);
  const notes=String(stored.practiceContent||"").split("\n").filter(line=>line!=="有練習："+stored.weeklyGoalText).join("\n").trim();
  const text=[(process.env.LAB_ENVIRONMENT==="functional-uat"?"【LAB｜個課練習進度】":"【個課練習進度】"),student.studentName||student.name||"學生",stored.eventDate+"｜練習 "+stored.minutes+" 分鐘","有練習："+stored.weeklyGoalText,notes?"練習紀錄："+notes.slice(0,500):"","對應個課："+lesson.eventDate,"這是家長回報的練習紀錄，不代表已熟練。","查看課後練習："+url].filter(Boolean).join("\n");
  const lineMessage=buildPrivatePracticeCard({studentName:student.studentName||student.name||"學生",practiceDate:stored.eventDate,minutes:stored.minutes,goalText:stored.weeklyGoalText,practiceNote:notes,lessonDate:lesson.eventDate,url:url.toString(),fallbackText:text,lab:process.env.LAB_ENVIRONMENT==="functional-uat"});
  return labNoticeLineResult(await deliverLabNotice({schoolId,eventId:"private-practice:"+stored.rowKey,recipients:[teacher],subject:"個課練習進度",text,lineMessage,stillDue:async()=>{const current=await noticeContext(schoolId,practice);return !!current&&current.teacher===teacher&&current.stored.weeklyGoalLessonId===stored.weeklyGoalLessonId&&current.stored.weeklyGoalText===stored.weeklyGoalText}}));
 }catch(error){console.error("private practice notification",error);return {status:"failed"}}
}
