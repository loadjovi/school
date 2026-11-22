import {uniquePracticeRows} from "./practiceRecords.js";
import {readWeeklyGoals,withinGoalWindow} from "./musicLearningGoals.mjs";

export function privatePracticeProgress(lesson,rows){
 const teacher=String(lesson.teacher||"").trim().toLowerCase();
 const records=uniquePracticeRows(rows).filter(row=>row.weeklyGoalLessonId===lesson.rowKey&&(!row.weeklyGoalTeacher||String(row.weeklyGoalTeacher).toLowerCase()===teacher)&&withinGoalWindow(lesson.eventDate,row.eventDate)&&Number.isSafeInteger(row.minutes)&&row.minutes>0).map(row=>({practiceId:row.rowKey,practiceDate:row.eventDate,minutes:row.minutes,goalText:String(row.weeklyGoalText||""),practiceContent:String(row.practiceContent||""),focus:String(row.focus||"")})).sort((a,b)=>String(b.practiceDate).localeCompare(String(a.practiceDate)));
 const goals=readWeeklyGoals(lesson.weeklyPracticeGoalsJson).map((text,index)=>{const linked=records.filter(row=>row.goalText===text);return {index,text,practiceCount:linked.length,minutes:linked.reduce((n,row)=>n+row.minutes,0),lastPracticeDate:linked[0]?.practiceDate||""}});
 return {lessonId:lesson.rowKey,lessonDate:lesson.eventDate,goals,records,totalSessions:records.length,totalMinutes:records.reduce((n,row)=>n+row.minutes,0),lastPracticeDate:records[0]?.practiceDate||""};
}
