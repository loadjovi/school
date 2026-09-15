import { app } from "@azure/functions";
import { getAccess, json } from "../lib/auth.js";
import { listTeacherDirectory, saveTeacherDirectory, getTeacherProfile } from "../lib/storage.js";

function clean(v,max=120){return String(v||"").trim().slice(0,max)}
function normalizeEmail(v){return clean(v,200).toLowerCase()}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}
function parse(raw,fallback=[]){try{return JSON.parse(String(raw||""))}catch{return fallback}}

app.http("teacherDirectory",{
  methods:["GET","POST","PATCH"],
  authLevel:"anonymous",
  route:"teacher-directory",
  handler:async(request)=>{
    const access=await getAccess(request);
    if(!access.authenticated)return json({error:"Unauthorized"},401);
    if(access.role!=="admin")return json({error:"Forbidden"},403);

    if(request.method==="GET"){
      const items=[];
      for(const t of await listTeacherDirectory()){
        const p=await getTeacherProfile(t.rowKey);
        items.push({
          email:t.rowKey,
          teacherName:t.teacherName||"",
          status:t.status||"active",
          updatedAt:t.updatedAt||null,
          sectionAssignments:p?parse(p.sectionAssignments,[]):[],
          ensembleGroups:p?parse(p.ensembleGroups,[]):[],
          comprehensiveEnabled:p?.comprehensiveEnabled===true,
          privateStudentIds:p?parse(p.privateStudentIds,[]):[]
        });
      }
      return json({items});
    }

    const body=await request.json();
    const email=normalizeEmail(body.email);
    const teacherName=clean(body.teacherName||body.name,80);
    const status=clean(body.status||"active",20)==="inactive"?"inactive":"active";
    if(!validEmail(email))return json({error:"請輸入正確的老師 Gmail"},400);
    if(teacherName.length<2)return json({error:"請輸入老師姓名"},400);

    const saved=await saveTeacherDirectory(email,{teacherName,status,updatedBy:access.email});
    return json({ok:true,teacher:{email:saved.rowKey,teacherName:saved.teacherName,status:saved.status}},request.method==="POST"?201:200);
  }
});
