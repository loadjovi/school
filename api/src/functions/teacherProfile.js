import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { getTeacherProfile, saveTeacherProfile, listStudentMaster } from "../lib/storage.js";

const allowedGroups=new Set(["A","B","儲備"]);
const allowedSections=new Set(["小提一部","小提二部","中提","大提","低音提"]);
const ensembleGroups=new Set(["A","B"]);

function parse(raw,fallback=[]){try{return JSON.parse(String(raw||""))}catch{return fallback}}
function uniq(list){return [...new Set(list)]}
function studentView(e){return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active"}}

app.http("teacherProfile",{
  methods:["GET","PATCH"],
  authLevel:"anonymous",
  route:"teacher-profile",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin"&&!access.capabilities?.teacherSettings)return json({error:"此帳號尚未被授權為老師，請管理員先將 Gmail 加入 TEACHER_EMAILS。"},403);

    const email=access.email;
    const current=await getTeacherProfile(email);
    const all=(await listStudentMaster("active")).map(studentView);

    if(request.method==="GET"){
      return json({
        email,
        profile:{
          sectionAssignments:current?parse(current.sectionAssignments,[]):access.sectionAssignments||[],
          ensembleGroups:current?parse(current.ensembleGroups,[]):access.ensembleGroups||[],
          privateStudentIds:current?parse(current.privateStudentIds,[]):access.privateStudentIds||[]
        },
        students:all,
        choices:{groups:["A","B","儲備"],sections:["小提一部","小提二部","中提","大提","低音提"],ensembleGroups:["A","B"]},
        schedule:{A:["週一","週三"],B:["週二","週四"],"儲備":["週五"]}
      });
    }

    const body=await request.json();
    const rawAssignments=Array.isArray(body.sectionAssignments)?body.sectionAssignments:[];
    const sectionAssignments=[];
    const seen=new Set();
    for(const x of rawAssignments){
      const groupName=String(x?.groupName||x?.group||"").trim();
      const section=String(x?.section||"").trim();
      if(!allowedGroups.has(groupName)||!allowedSections.has(section))return json({error:`無效的分部課設定：${groupName}／${section}`},400);
      const k=`${groupName}|${section}`;if(!seen.has(k)){seen.add(k);sectionAssignments.push({groupName,section})}
    }

    const eGroups=uniq((Array.isArray(body.ensembleGroups)?body.ensembleGroups:[]).map(String).map(x=>x.trim()).filter(Boolean));
    if(eGroups.some(x=>!ensembleGroups.has(x)))return json({error:"團體課僅可選 A 團或 B 團"},400);

    const privateStudentIds=uniq((Array.isArray(body.privateStudentIds)?body.privateStudentIds:[]).map(String).map(x=>x.trim()).filter(Boolean));
    const activeIds=new Set(all.map(x=>String(x.studentId)));
    const invalid=privateStudentIds.filter(x=>!activeIds.has(x));
    if(invalid.length)return json({error:`個課學生不存在或已離團：${invalid.join(", ")}`},400);

    await saveTeacherProfile(email,{displayName:access.displayName,sectionAssignments,ensembleGroups:eGroups,privateStudentIds});
    return json({ok:true,profile:{sectionAssignments,ensembleGroups:eGroups,privateStudentIds}});
  }
});
