import {createHash} from "node:crypto";

const clean=(value,max=120)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,max);
const emailValue=value=>clean(value,320).toLowerCase();
const digest=value=>createHash("sha256").update(String(value??"")).digest("hex");

export function maskParentEmail(value){
  const email=emailValue(value),at=email.indexOf("@");
  if(at<1)return "未提供";
  const local=email.slice(0,at),domain=email.slice(at+1);
  return `${local.slice(0,1)}***@${domain}`;
}

export function parentCoverageKey(schoolId,email){
  return digest(`${clean(schoolId,100)}:${emailValue(email)}`).slice(0,24);
}

function normalizeBinding(value){
  if(!value?.bound)return {bound:false,friendStatus:"unbound",lineDisplayName:"",boundAt:""};
  const friendStatus=["friend","not_friend","unknown"].includes(String(value.friendStatus||""))
    ?String(value.friendStatus):"unknown";
  return {
    bound:true,
    friendStatus,
    lineDisplayName:clean(value.lineDisplayName,100),
    boundAt:clean(value.boundAt,80)
  };
}

/**
 * Build a student-centred read model while keeping LINE identity owned by the
 * parent account. One parent linked to siblings is counted once as a parent,
 * and once for each covered student.
 */
export function buildLabLineStudentCoverage({students=[],parentLinks=[],bindingsByEmail=new Map()}={}){
  const active=(Array.isArray(students)?students:[]).filter(student=>String(student?.status||"active")==="active");
  const activeIds=new Set(active.map(student=>clean(student?.studentId||student?.rowKey,120)).filter(Boolean));
  const linksByStudent=new Map(),seenLinks=new Set(),uniqueParents=new Set();

  for(const link of Array.isArray(parentLinks)?parentLinks:[]){
    const studentId=clean(link?.studentId,120),email=emailValue(link?.parentEmail);
    if(!activeIds.has(studentId)||!email||String(link?.status||"active")!=="active")continue;
    const key=`${studentId}|${email}`;
    if(seenLinks.has(key))continue;
    seenLinks.add(key);uniqueParents.add(email);
    if(!linksByStudent.has(studentId))linksByStudent.set(studentId,[]);
    linksByStudent.get(studentId).push({
      email,
      parentName:clean(link?.parentName,80),
      relationship:clean(link?.relationship||"家長",30)
    });
  }

  const bindingFor=email=>normalizeBinding(bindingsByEmail instanceof Map?bindingsByEmail.get(email):bindingsByEmail?.[email]);
  const uniqueBoundParents=new Set(),uniqueNotifiableParents=new Set();
  for(const email of uniqueParents){
    const binding=bindingFor(email);
    if(binding.bound)uniqueBoundParents.add(email);
    if(binding.bound&&binding.friendStatus==="friend")uniqueNotifiableParents.add(email);
  }

  const items=active.map(student=>{
    const studentId=clean(student?.studentId||student?.rowKey,120);
    const parents=(linksByStudent.get(studentId)||[]).map(parent=>{
      const binding=bindingFor(parent.email);
      return {
        parentEmailMasked:maskParentEmail(parent.email),
        parentName:parent.parentName,
        relationship:parent.relationship,
        ...binding
      };
    }).sort((a,b)=>a.relationship.localeCompare(b.relationship,"zh-Hant")||a.parentEmailMasked.localeCompare(b.parentEmailMasked));
    const parentCount=parents.length;
    const lineBoundParentCount=parents.filter(parent=>parent.bound).length;
    const notifiableParentCount=parents.filter(parent=>parent.bound&&parent.friendStatus==="friend").length;
    const unknownFriendCount=parents.filter(parent=>parent.bound&&parent.friendStatus==="unknown").length;
    const status=!parentCount?"NO_PARENT":notifiableParentCount?"NOTIFIABLE":unknownFriendCount?"BOUND_UNKNOWN":lineBoundParentCount?"BOUND_NOT_FRIEND":"UNBOUND";
    return {
      studentId,
      studentName:clean(student?.studentName||student?.name,80),
      parentCount,
      lineBoundParentCount,
      notifiableParentCount,
      status,
      parents
    };
  }).sort((a,b)=>a.studentName.localeCompare(b.studentName,"zh-Hant")||a.studentId.localeCompare(b.studentId));

  const count=status=>items.filter(item=>item.status===status).length;
  const boundStudents=items.filter(item=>item.lineBoundParentCount>0).length;
  const notifiableStudents=items.filter(item=>item.notifiableParentCount>0).length;
  return {
    summary:{
      activeStudents:items.length,
      boundStudents,
      notifiableStudents,
      unboundStudents:items.length-boundStudents,
      friendStatusPendingStudents:count("BOUND_UNKNOWN"),
      notFriendStudents:count("BOUND_NOT_FRIEND"),
      noParentStudents:count("NO_PARENT"),
      uniqueParentAccounts:uniqueParents.size,
      uniqueBoundParents:uniqueBoundParents.size,
      uniqueNotifiableParents:uniqueNotifiableParents.size
    },
    items
  };
}
