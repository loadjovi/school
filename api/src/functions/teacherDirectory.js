import { app } from "@azure/functions";
import { getTenantContext, json } from "../lib/auth.js";
import { sendTeacherAccessEnabledEmail } from "../lib/email.js";
import { listTeacherDirectory, saveTeacherDirectory, getTeacherProfile, saveTeacherProfile, listStudentMaster, listActivityRange, getTenantDirectory } from "../lib/storage.js";

function clean(v,max=120){return String(v||"").trim().slice(0,max)}
function normalizeEmail(v){return clean(v,200).toLowerCase()}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function parse(raw,fallback=[]){try{return JSON.parse(String(raw||""))}catch{return fallback}}
function uniq(list){return [...new Set((Array.isArray(list)?list:[]).map(String).map(x=>x.trim()).filter(Boolean))]}
function studentView(e){return {studentId:String(e.rowKey),name:String(e.studentName||""),grade:String(e.grade||""),groupName:String(e.groupName||""),instrument:String(e.instrument||""),section:String(e.section||"待確認")}}

function publicAppUrl(request){
  const explicit=clean(process.env.APP_PUBLIC_URL||process.env.SWA_PUBLIC_URL||"",1000);
  const candidates=[explicit,clean(request.headers.get("origin"),1000),clean(request.headers.get("referer"),1000)];
  const forwardedHost=clean(request.headers.get("x-forwarded-host"),500),forwardedProto=clean(request.headers.get("x-forwarded-proto"),20)||"https";
  if(forwardedHost)candidates.push(`${forwardedProto}://${forwardedHost}`);
  for(const raw of candidates){
    if(!raw||raw==="null")continue;
    try{
      const u=new URL(raw),host=String(u.hostname||"").toLowerCase();
      if(!["http:","https:"].includes(u.protocol)||host.endsWith(".azurewebsites.net"))continue;
      return u.origin+"/";
    }catch{}
  }
  return "";
}

app.http("teacherDirectory",{
  methods:["GET","POST","PATCH"],authLevel:"anonymous",route:"teacher-directory",
  handler:async(request)=>{
    const context=await getTenantContext(request);if(context.error)return context.error;
    const {access,schoolId}=context;
    if(access.role!=="admin")return json({error:"Forbidden"},403);
    if(request.method==="GET"){
      const ratingMap=new Map();
      for(const e of await listActivityRange("privateLesson",schoolId)){
        const email=normalizeEmail(e.teacher),rating=Number(e.teacherRating||0);
        if(!email||!Number.isInteger(rating)||rating<1||rating>5)continue;
        const old=ratingMap.get(email)||{ratingCount:0,ratingTotal:0,fiveStarCount:0,reviews:[]};
        old.ratingCount++;old.ratingTotal+=rating;if(rating===5)old.fiveStarCount++;
        const review=clean(e.teacherReview,800);
        if(review)old.reviews.push({rating,review,lessonDate:String(e.eventDate||""),ratedAt:String(e.teacherRatedAt||"")});
        ratingMap.set(email,old);
      }
      for(const v of ratingMap.values())v.reviews.sort((a,b)=>String(b.ratedAt||b.lessonDate).localeCompare(String(a.ratedAt||a.lessonDate)));
      const items=[];
      for(const t of await listTeacherDirectory(schoolId)){
        const p=await getTeacherProfile(t.rowKey,schoolId);
        const sectionAssignments=p?parse(p.sectionAssignments,[]):[],ensembleGroups=p?parse(p.ensembleGroups,[]):[],privateStudentIds=p?parse(p.privateStudentIds,[]):[],comprehensiveEnabled=p?.comprehensiveEnabled===true;
        const privateOnly=privateStudentIds.length>0&&!sectionAssignments.length&&!ensembleGroups.length&&!comprehensiveEnabled;
        const r=ratingMap.get(normalizeEmail(t.rowKey))||{ratingCount:0,ratingTotal:0,fiveStarCount:0,reviews:[]};
        const ratingAverage=r.ratingCount?Math.round((r.ratingTotal/r.ratingCount)*100)/100:null;
        items.push({email:t.rowKey,teacherName:t.teacherName||"",status:t.status||"active",updatedAt:t.updatedAt||null,lastLoginAt:t.lastLoginAt||null,sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds,privateOnly,
          ratingAverage,ratingCount:r.ratingCount,fiveStarCount:r.fiveStarCount,recentReviews:r.reviews.slice(0,3)});
      }
      const students=(await listStudentMaster("active",schoolId)).map(studentView);
      return json({items,students});
    }
    const body=await request.json();
    const email=normalizeEmail(body.email),teacherName=clean(body.teacherName||body.name,80),status=clean(body.status||"active",20)==="inactive"?"inactive":"active";
    if(!validEmail(email))return json({error:"請輸入正確的老師 Gmail"},400);
    if(teacherName.length<2)return json({error:"請輸入老師姓名"},400);
    const saved=await saveTeacherDirectory(email,{teacherName,status,updatedBy:access.email},schoolId);

    if(body.privateOnly===true){
      const privateStudentIds=uniq(body.privateStudentIds);
      if(!privateStudentIds.length)return json({error:"個課限定老師至少需要綁定 1 位學生"},400);
      const activeIds=new Set((await listStudentMaster("active",schoolId)).map(x=>String(x.rowKey)));
      const invalid=privateStudentIds.filter(id=>!activeIds.has(id));
      if(invalid.length)return json({error:`指定學生不存在或已離團：${invalid.join(", ")}`},400);
      await saveTeacherProfile(email,{displayName:teacherName,sectionAssignments:[],ensembleGroups:[],comprehensiveEnabled:false,privateStudentIds},schoolId);
    }

    let emailNotification=null;
    if(request.method==="POST"&&status==="active"){
      try{
        const tenant=await getTenantDirectory(schoolId);
        const schoolName=clean(tenant?.systemName||tenant?.schoolName||access.schoolName||"弦樂團管理系統",120);
        emailNotification=await sendTeacherAccessEnabledEmail({
          recipient:email,
          teacherName,
          schoolName,
          appUrl:publicAppUrl(request),
          privateOnly:body.privateOnly===true,
          boundStudentCount:body.privateOnly===true?uniq(body.privateStudentIds).length:0
        });
      }catch(e){
        console.error("Teacher access notification failed:",e);
        emailNotification={status:"failed",recipientCount:1,sentCount:0,failedCount:1,error:clean(e?.message||e,300)};
      }
    }
    return json({ok:true,teacher:{email:saved.rowKey,teacherName:saved.teacherName,status:saved.status},emailNotification},request.method==="POST"?201:200);
  }
});
