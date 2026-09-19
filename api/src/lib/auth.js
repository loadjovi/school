import { OAuth2Client } from "google-auth-library";
import { getMappedStudentsByEmail, listStudentMaster, getTeacherProfile, getTeacherDirectory, listUserStudentMappings, ensureDefaultTenant, ensureBootstrapGlobalAdmin, listTenantRolesByEmail, getTenantDirectory, defaultTenantId } from "./storage.js";

const googleClient = new OAuth2Client();
let aliasCache=null,aliasCacheAt=0;

export function parseJsonEnv(name, fallback={}){
  try{return JSON.parse(process.env[name]||JSON.stringify(fallback))}catch{return fallback}
}

function parseJsonValue(raw,fallback=[]){
  try{return JSON.parse(String(raw||""))}catch{return fallback}
}

function cookieValue(request,name){
  const raw=String(request.headers.get("cookie")||"");
  for(const part of raw.split(";")){
    const i=part.indexOf("=");
    if(i<0)continue;
    if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());
  }
  return "";
}

function googleToken(request){
  const session=cookieValue(request,"orchestra_google_id_token");
  if(session)return session;
  const custom=String(request.headers.get("x-google-id-token")||"").trim();
  if(custom&&custom!=="cookie-session")return custom;
  const auth=String(request.headers.get("authorization")||"");
  if(!auth.toLowerCase().startsWith("bearer "))return "";
  return auth.slice(7).trim();
}

export async function verifyGoogleToken(token){
  const audience=String(process.env.GOOGLE_CLIENT_ID||"").trim();
  if(!token||!audience)return null;
  try{
    const ticket=await googleClient.verifyIdToken({idToken:token,audience});
    const p=ticket.getPayload();
    if(!p?.email||p.email_verified!==true)return null;
    return {sub:p.sub,email:String(p.email).trim().toLowerCase(),displayName:p.name||p.email,picture:p.picture||null};
  }catch(err){
    console.error("Google ID token verification failed:",err?.message||String(err));
    return null;
  }
}

export async function verifyGoogle(request){return verifyGoogleToken(googleToken(request))}

function normalizeProfile(profile){
  const sectionAssignments=(parseJsonValue(profile?.sectionAssignments,[])||[]).map(x=>({groupName:String(x?.groupName||"").trim(),section:String(x?.section||"").trim()})).filter(x=>x.groupName&&x.section);
  const ensembleGroups=[...new Set((parseJsonValue(profile?.ensembleGroups,[])||[]).map(String).filter(x=>["A","B"].includes(x)))];
  const comprehensiveEnabled=profile?.comprehensiveEnabled===true;
  const privateStudentIds=[...new Set((parseJsonValue(profile?.privateStudentIds,[])||[]).map(String).filter(Boolean))];
  return {sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds};
}

function viewMaster(e,legacyStudentIds=[]){
  return {studentId:e.rowKey,name:e.studentName,grade:e.grade,groupName:e.groupName,instrument:e.instrument,section:e.section||"待確認",schoolYear:e.schoolYear||"",status:e.status||"active",source:"studentMaster",legacyStudentIds:[...new Set((legacyStudentIds||[]).map(String).filter(x=>x&&x!==String(e.rowKey)))]};
}

function staticParentMapEntries(){
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{}),rows=[];
  for(const [email,value] of Object.entries(parentMap||{})){
    const list=Array.isArray(value)?value:(Array.isArray(value?.students)?value.students:[]);
    for(const s of list)if(s&&typeof s==="object"&&s.studentId)rows.push({...s,parentEmail:String(email||"").trim().toLowerCase(),source:"studentMapJson"});
  }
  return rows;
}

async function allLegacyStudentEntries(){
  const rows=[...staticParentMapEntries()];
  try{
    for(const m of await listUserStudentMappings("active")){
      if(!m?.studentId)continue;
      rows.push({
        studentId:m.studentId,
        name:m.studentName,
        grade:m.grade,
        groupName:m.groupName,
        instrument:m.instrument,
        section:m.section,
        schoolYear:m.schoolYear,
        parentEmail:String(m.parentEmail||"").trim().toLowerCase(),
        source:"userStudentMap"
      });
    }
  }catch(err){
    console.error("Unable to load UserStudentMap aliases:",err?.message||String(err));
  }
  return rows;
}

function normName(v){return String(v||"").replace(/\s+/g,"").trim()}
function same(a,b){return String(a||"").trim()&&String(a||"").trim()===String(b||"").trim()}
function masterQuality(m){
  let score=0;
  if(String(m?.classCode||"").trim())score+=24;
  if(String(m?.section||"").trim()&&String(m.section)!=="待確認")score+=12;
  if(String(m?.schoolYear||"").trim())score+=6;
  if(String(m?.grade||"").trim())score+=3;
  if(String(m?.instrument||"").trim()&&String(m.instrument)!=="待確認")score+=3;
  if(/^SH\d+$/.test(String(m?.rowKey||"")))score+=2;
  return score;
}
function pickCanonicalMaster(raw,matches=[]){
  if(!matches.length)return null;
  let candidates=matches.filter(m=>String(m.status||"active")!=="inactive");
  if(!candidates.length)candidates=matches;
  if(candidates.length===1)return candidates[0];
  const scored=candidates.map(m=>{
    let score=masterQuality(m);
    if(same(raw.groupName,m.groupName))score+=8;
    if(String(raw.section||"").trim()&&String(raw.section)!=="待確認"&&same(raw.section,m.section||"待確認"))score+=6;
    if(same(raw.instrument,m.instrument))score+=4;
    if(same(raw.grade,m.grade))score+=3;
    if(same(raw.schoolYear,m.schoolYear))score+=2;
    return {m,score};
  }).sort((a,b)=>b.score-a.score);
  if(scored[0]?.score>0&&scored[0].score>(scored[1]?.score??-1))return scored[0].m;
  return null;
}
function preferredDuplicateMaster(matches=[]){
  const active=matches.filter(m=>String(m.status||"active")!=="inactive");
  const candidates=active.length?active:matches;
  if(candidates.length<2)return null;
  const curated=candidates.filter(m=>String(m.classCode||"").trim());
  if(curated.length===1&&candidates.some(m=>!String(m.classCode||"").trim()))return curated[0];
  const scored=candidates.map(m=>({m,score:masterQuality(m)})).sort((a,b)=>b.score-a.score);
  if(scored[0]?.score>=20&&scored[0].score>(scored[1]?.score??-1)+8)return scored[0].m;
  return null;
}

function resolveCanonicalMaster(raw,oldId,byId,byName){
  const exact=byId.get(oldId)||null;
  const name=normName(raw.name||raw.studentName||exact?.studentName||"");
  const matches=name?(byName.get(name)||[]):[];
  const exactActive=exact&&String(exact.status||"active")!=="inactive";

  if(matches.length>1){
    const curated=preferredDuplicateMaster(matches);
    if(curated)return curated;
    const picked=pickCanonicalMaster(raw,matches);
    if(picked)return picked;
  }
  if(exact&&!exactActive){
    const picked=pickCanonicalMaster(raw,matches);
    return picked||exact;
  }
  if(exact)return exact;
  return pickCanonicalMaster(raw,matches);
}

async function buildStudentAliasIndex(){
  if(aliasCache&&Date.now()-aliasCacheAt<15000)return aliasCache;
  const masters=await listStudentMaster();
  const byId=new Map(masters.map(m=>[String(m.rowKey),m]));
  const byName=new Map();
  for(const m of masters){
    const name=normName(m.studentName);
    if(!name)continue;
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(m);
  }
  const aliasToCanonical=new Map(),canonicalToAliases=new Map(),canonicalToParentEmails=new Map(),parentToCanonicals=new Map();

  for(const [name,matches] of byName.entries()){
    const preferred=preferredDuplicateMaster(matches);
    if(!preferred)continue;
    const canonical=String(preferred.rowKey);
    if(!canonicalToAliases.has(canonical))canonicalToAliases.set(canonical,new Set([canonical]));
    for(const m of matches){
      const id=String(m.rowKey);
      if(id===canonical)continue;
      aliasToCanonical.set(id,canonical);
      canonicalToAliases.get(canonical).add(id);
    }
  }

  for(const raw of await allLegacyStudentEntries()){
    const oldId=String(raw.studentId||"").trim();
    if(!oldId)continue;
    const master=resolveCanonicalMaster(raw,oldId,byId,byName);
    const canonical=master?String(master.rowKey):(aliasToCanonical.get(oldId)||oldId);
    aliasToCanonical.set(oldId,canonical);
    if(!canonicalToAliases.has(canonical))canonicalToAliases.set(canonical,new Set([canonical]));
    canonicalToAliases.get(canonical).add(oldId);
    const parentEmail=String(raw.parentEmail||"").trim().toLowerCase();
    if(parentEmail){
      if(!canonicalToParentEmails.has(canonical))canonicalToParentEmails.set(canonical,new Set());
      canonicalToParentEmails.get(canonical).add(parentEmail);
      if(!parentToCanonicals.has(parentEmail))parentToCanonicals.set(parentEmail,new Set());
      parentToCanonicals.get(parentEmail).add(canonical);
    }
  }
  for(const id of byId.keys())if(!canonicalToAliases.has(id)&&!aliasToCanonical.has(id))canonicalToAliases.set(id,new Set([id]));
  aliasCache={masters,byId,byName,aliasToCanonical,canonicalToAliases,canonicalToParentEmails,parentToCanonicals};aliasCacheAt=Date.now();
  return aliasCache;
}

export async function canonicalizeStudents(list=[]){
  const index=await buildStudentAliasIndex(),out=new Map();
  for(const raw of Array.isArray(list)?list:[]){
    if(typeof raw==="string"){
      const canonical=index.aliasToCanonical.get(raw)||raw,master=index.byId.get(canonical);
      out.set(canonical,master?viewMaster(master,[...(index.canonicalToAliases.get(canonical)||[])]):{studentId:raw,name:raw});
      continue;
    }
    if(!raw||typeof raw!=="object")continue;
    const rawId=String(raw.studentId||raw.rowKey||"").trim(),name=normName(raw.name||raw.studentName||"");
    let canonical=index.aliasToCanonical.get(rawId)||rawId;
    if(!index.byId.has(canonical)&&name){
      const master=resolveCanonicalMaster(raw,rawId,index.byId,index.byName);
      if(master)canonical=String(master.rowKey);
    }
    const master=index.byId.get(canonical);
    const aliases=new Set([rawId,...(index.canonicalToAliases.get(canonical)||[])]);
    out.set(canonical,master?viewMaster(master,[...aliases]):{...raw,studentId:rawId,legacyStudentIds:[]});
  }
  return [...out.values()];
}

export async function getStudentAliasInfo(studentId){
  const id=String(studentId||"").trim();
  if(!id)return {canonicalStudentId:"",aliases:[],safeParentEmails:[]};
  const index=await buildStudentAliasIndex();
  const canonical=index.aliasToCanonical.get(id)||id;
  const aliases=[...new Set([canonical,id,...(index.canonicalToAliases.get(canonical)||[])])].filter(Boolean);
  const safeParentEmails=[...(index.canonicalToParentEmails.get(canonical)||[])].filter(email=>(index.parentToCanonicals.get(email)||new Set()).size===1);
  return {canonicalStudentId:canonical,aliases,safeParentEmails};
}

export async function getStudentIdAliases(studentId){
  return (await getStudentAliasInfo(studentId)).aliases;
}

export async function getAccess(request){
  const identity=await verifyGoogle(request);
  if(!identity)return {authenticated:false};
  const email=identity.email;
  const parentMap=parseJsonEnv("STUDENT_MAP_JSON",{});
  const admins=String(process.env.ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  const defaultId=defaultTenantId();
  let defaultTenant;
  try{defaultTenant=await ensureDefaultTenant(email)}catch(e){console.warn("tenant bootstrap failed",e?.message||String(e));defaultTenant={rowKey:defaultId,schoolName:"聖心小學",systemName:"聖心小學弦樂團"}}

  const requestedContext=String(request.headers.get("x-role-context")||"").trim();
  const requestedSchoolId=String(request.headers.get("x-school-id")||"").trim().toLowerCase();
  if(["teacher","parent"].includes(requestedContext)&&requestedSchoolId&&requestedSchoolId!==defaultId){
    return {authenticated:true,...identity,role:"contextDenied",schoolId:requestedSchoolId,schoolName:"",systemName:"",capabilities:{contextDenied:true}};
  }
  const bootstrapGlobal=admins.includes(email);
  if(bootstrapGlobal){
    try{await ensureBootstrapGlobalAdmin(email)}catch(e){console.warn("global admin bootstrap failed",e?.message||String(e))}
  }

  let tenantRoles=[];
  try{tenantRoles=await listTenantRolesByEmail(email,"active")}catch(e){console.warn("tenant role lookup failed",e?.message||String(e))}
  const globalRole=tenantRoles.find(x=>x.role==="globalAdmin")||(bootstrapGlobal?{role:"globalAdmin",schoolId:"*"}:null);
  const schoolRoles=tenantRoles.filter(x=>x.role==="schoolAdmin"&&x.schoolId&&x.schoolId!=="*");
  if(globalRole||schoolRoles.length){
    const memberships=[],activeRoles=[];
    for(const r of schoolRoles){
      const t=await getTenantDirectory(r.schoolId);
      const membership={schoolId:r.schoolId,role:"schoolAdmin",schoolName:String(t?.schoolName||r.schoolId),status:String(t?.status||"setup")};
      memberships.push(membership);
      if(membership.status==="active")activeRoles.push(r);
    }

    const selectedRole=requestedSchoolId?activeRoles.find(x=>String(x.schoolId)===requestedSchoolId):null;
    const wantsTeacher=requestedContext==="teacher";
    const wantsParent=requestedContext==="parent";
    const wantsSchoolAdmin=requestedContext==="schoolAdmin";
    const wantsGlobal=requestedContext==="global";

    if(globalRole&&!wantsTeacher&&!wantsParent){
      if(wantsSchoolAdmin){
        if(selectedRole){
          const tenant=await getTenantDirectory(selectedRole.schoolId)||defaultTenant;
          return {authenticated:true,...identity,role:"admin",schoolId:String(selectedRole.schoolId),schoolName:String(tenant?.schoolName||selectedRole.schoolId),systemName:String(tenant?.systemName||tenant?.schoolName||selectedRole.schoolId),memberships,capabilities:{admin:true,tenantAdmin:true,globalAdmin:false,identityGlobalAdmin:true}};
        }
        return {authenticated:true,...identity,role:"contextDenied",schoolId:requestedSchoolId||null,schoolName:"",systemName:"",memberships,capabilities:{globalAdmin:true,contextDenied:true}};
      }
      if(wantsGlobal||!requestedContext){
        return {authenticated:true,...identity,role:"globalAdmin",schoolId:null,schoolName:"",systemName:"Global 多校管理",memberships,capabilities:{globalAdmin:true,globalReadOnly:true}};
      }
    }

    if(!globalRole&&activeRoles.length&&!wantsTeacher&&!wantsParent){
      const selected=selectedRole||(!requestedContext?(activeRoles.find(x=>x.schoolId===defaultId)||activeRoles[0]):null);
      if(selected){
        const tenant=await getTenantDirectory(selected.schoolId)||defaultTenant;
        return {authenticated:true,...identity,role:"admin",schoolId:String(selected.schoolId),schoolName:String(tenant?.schoolName||selected.schoolId),systemName:String(tenant?.systemName||tenant?.schoolName||selected.schoolId),memberships,capabilities:{admin:true,tenantAdmin:true,globalAdmin:false}};
      }
      if(wantsSchoolAdmin)return {authenticated:true,...identity,role:"contextDenied",schoolId:requestedSchoolId||null,schoolName:"",systemName:"",memberships,capabilities:{contextDenied:true}};
    }

    if(!requestedContext&&!globalRole&&!activeRoles.length){
      const pending=memberships[0]||{schoolId:defaultId,schoolName:"學校",status:"setup"};
      return {authenticated:true,...identity,role:"tenantPending",schoolId:pending.schoolId,schoolName:pending.schoolName,systemName:pending.schoolName+" 管理系統",memberships,capabilities:{tenantPending:true}};
    }
  }

  const directory=await getTeacherDirectory(email);
  if(directory?.status==="active"&&(!requestedContext||requestedContext==="teacher")){
    const profile=await getTeacherProfile(email);
    const {sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds:rawPrivateStudentIds}=normalizeProfile(profile);
    const index=await buildStudentAliasIndex();
    const privateStudentIds=[...new Set(rawPrivateStudentIds.map(id=>index.aliasToCanonical.get(String(id))||String(id)))];
    const capabilities={section:sectionAssignments.length>0,ensemble:ensembleGroups.length>0,comprehensive:comprehensiveEnabled,private:privateStudentIds.length>0,teacherSettings:true};
    const masters=await listStudentMaster("active");
    const byId=new Map();
    for(const m of masters){
      const rawId=String(m.rowKey),canonicalId=index.aliasToCanonical.get(rawId)||rawId;
      const canonicalMaster=index.byId.get(canonicalId)||m;
      const v=viewMaster(canonicalMaster,[...(index.canonicalToAliases.get(canonicalId)||[])]);
      const sectionMatch=sectionAssignments.some(a=>a.groupName===v.groupName&&a.section===v.section);
      const ensembleMatch=ensembleGroups.includes(v.groupName);
      const comprehensiveMatch=comprehensiveEnabled&&["A","B","儲備"].includes(v.groupName);
      const privateMatch=privateStudentIds.includes(v.studentId);
      if(sectionMatch||ensembleMatch||comprehensiveMatch||privateMatch)byId.set(v.studentId,v);
    }
    const role=capabilities.section?"sectionTeacher":capabilities.ensemble?"ensembleTeacher":capabilities.comprehensive?"comprehensiveTeacher":capabilities.private?"privateTeacher":"teacher";
    return {authenticated:true,...identity,displayName:directory.teacherName||identity.displayName,role,schoolId:defaultId,schoolName:String(defaultTenant.schoolName||"聖心小學"),systemName:String(defaultTenant.systemName||"聖心小學弦樂團"),capabilities,sectionAssignments,assignments:sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds,students:[...byId.values()]};
  }

  if(!requestedContext||requestedContext==="parent"){
    if(parentMap[email])return {authenticated:true,...identity,role:"parent",schoolId:defaultId,schoolName:String(defaultTenant.schoolName||"聖心小學"),systemName:String(defaultTenant.systemName||"聖心小學弦樂團"),students:await canonicalizeStudents(parentMap[email])};
    const dynamicStudents=await getMappedStudentsByEmail(email);
    if(dynamicStudents.length)return {authenticated:true,...identity,role:"parent",schoolId:defaultId,schoolName:String(defaultTenant.schoolName||"聖心小學"),systemName:String(defaultTenant.systemName||"聖心小學弦樂團"),students:await canonicalizeStudents(dynamicStudents)};
  }
  return {authenticated:true,...identity,role:requestedContext?"contextDenied":"unassigned",schoolId:requestedSchoolId||defaultId,schoolName:String(defaultTenant.schoolName||"聖心小學"),systemName:String(defaultTenant.systemName||"聖心小學弦樂團"),capabilities:requestedContext?{contextDenied:true}:{}};
}

export function json(body,status=200){return {status,jsonBody:body,headers:{"Content-Type":"application/json; charset=utf-8"}}}

export function allowedStudentIds(access){
  if(access.role==="admin")return null;
  const ids=[];
  for(const s of access.students||[]){
    if(typeof s==="string")ids.push(s);
    else if(s?.studentId){ids.push(String(s.studentId));for(const x of s.legacyStudentIds||[])ids.push(String(x))}
  }
  return [...new Set(ids)];
}

export function ensureStudentAccess(access,studentId){
  if(access.role==="admin")return true;
  return (allowedStudentIds(access)||[]).includes(String(studentId));
}

export function ensureSectionAccess(access,student){
  if(access.role==="admin")return true;
  if(!access.capabilities?.section)return false;
  return (access.sectionAssignments||[]).some(a=>a.groupName===student.groupName&&a.section===(student.section||"待確認"));
}

export function ensureEnsembleAccess(access,student){
  if(access.role==="admin")return true;
  return !!access.capabilities?.ensemble&&(access.ensembleGroups||[]).includes(student.groupName);
}

export function ensureComprehensiveAccess(access,student){
  if(access.role==="admin")return true;
  return !!access.capabilities?.comprehensive&&["A","B","儲備"].includes(String(student?.groupName||""));
}

export function ensurePrivateAccess(access,studentId){
  if(access.role==="admin")return true;
  return !!access.capabilities?.private&&(access.privateStudentIds||[]).includes(String(studentId));
}
