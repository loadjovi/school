import { app } from "@azure/functions";
import { getTenantContext, ensureStudentAccess, canonicalizeStudents, getStudentAliasInfo, json } from "../lib/auth.js";
import { listActivityRange, listStudentMaster } from "../lib/storage.js";
import { buildPracticeLeaderboard, practiceScoreMonths } from "../lib/practiceLeaderboard.js";

function taipeiDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}

app.http("parentPracticeLeaderboard",{
  methods:["GET"],authLevel:"anonymous",route:"parent-practice-leaderboard",
  handler:async request=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="parent")return json({error:"Forbidden"},403);
    const studentId=String(request.query.get("studentId")||"").trim();
    if(!studentId||!ensureStudentAccess(access,studentId))return json({error:"Forbidden"},403);
    const asOf=taipeiDate(),months=practiceScoreMonths(asOf);
    const includedMonths=months.filter(month=>month<=asOf.slice(0,7));
    const qualifiedMinutes=Math.max(1,Number(process.env.PRACTICE_QUALIFIED_MINUTES||15));
    const targetDays=Math.max(1,Number(process.env.PRACTICE_TARGET_DAYS||30));
    if(!includedMonths.length)return json({asOf,months,includedMonths,qualifiedMinutes,targetDays,participantCount:0,items:[],mine:null});

    // 每次只讀取登入家長所屬學校的在籍學生與正式計分月份；9 月試行紀錄不參與排名。
    const [masters,rows]=await Promise.all([
      listStudentMaster("active",schoolId),
      listActivityRange("practice",schoolId,`${includedMonths[0]}-01`,asOf)
    ]);
    const canonical=await canonicalizeStudents(masters.map(x=>({studentId:x.rowKey,name:x.studentName})),schoolId);
    const students=await Promise.all(canonical.map(async student=>{
      const info=await getStudentAliasInfo(student.studentId,schoolId);
      return {...student,aliases:info.aliases,safeParentEmails:info.safeParentEmails};
    }));
    const result=buildPracticeLeaderboard({students,rows,months,today:asOf,studentId,qualifiedMinutes,targetDays});
    return json({asOf,months,qualifiedMinutes,targetDays,...result});
  }
});
