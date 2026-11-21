import {getStudentAliasInfo,normalizeProfile} from "./auth.js";
import {getTeacherProfile,listStudentMaster,listTeacherDirectory,listTenantAdmins,listUserStudentMappings} from "./storage.js";
import {financeAssignments} from "./financeAccess.js";
import {financeRecipients} from "./financeNoticeRules.mjs";
import {teacherCourseAccess} from "./teacherAccountType.js";
import {getTenantLineRecipient} from "./tenantLineAccounts.js";

export const lineAudienceRoles = ["parent","teacher","staff","finance"];
const normalized = text => String(text||"").trim().normalize("NFC");
const emailOf = text => normalized(text).toLowerCase();
const studentId = row => String(row.rowKey||row.studentId||"");

export async function lineAudienceStudents(schoolId) {
  return listStudentMaster("active",schoolId);
}

export function lineAudienceGroups(students) {
  return [...new Set(students.map(row=>normalized(row.groupName)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant"));
}

export async function resolveLineAudience(schoolId, botUserId, {roles,groups,students}) {
  const teamMembers=students.filter(row=>!groups.length||groups.includes(normalized(row.groupName)));
  const ids=new Set(teamMembers.map(studentId).filter(Boolean));
  const emails=new Set();
  const include = rows => rows.map(emailOf).filter(Boolean).forEach(email=>emails.add(email));
  if(roles.includes("parent")){
    const mappings=await listUserStudentMappings("active",schoolId);
    for(const mapping of mappings){
      if(!mapping.studentId||!mapping.parentEmail)continue;
      const alias=await getStudentAliasInfo(mapping.studentId,schoolId);
      if(ids.has(String(alias.canonicalStudentId||mapping.studentId)))include([mapping.parentEmail]);
    }
  }
  if(roles.includes("teacher")){
    const directory=(await listTeacherDirectory(schoolId)).filter(row=>row.status==="active");
    const candidates=await Promise.all(directory.map(async row=>{
      const email=emailOf(row.rowKey);
      if(!groups.length)return email;
      const profile=teacherCourseAccess(row,normalizeProfile(await getTeacherProfile(email,schoolId)));
      return teamMembers.some(student=>
        profile.ensembleGroups.includes(student.groupName) ||
        profile.sectionAssignments.some(entry=>entry.groupName===student.groupName&&entry.section===student.section) ||
        profile.comprehensiveEnabled&&["A","B","儲備"].includes(student.groupName) ||
        profile.privateStudentIds.includes(studentId(student))) ? email : "";
    }));
    include(candidates);
  }
  if(roles.includes("staff")||roles.includes("finance")){
    const admins=await listTenantAdmins(schoolId,"active");
    if(roles.includes("staff"))include(admins.filter(row=>row.role==="schoolAdmin"&&row.status==="active").map(row=>row.partitionKey||row.email));
    if(roles.includes("finance"))include(financeRecipients(admins,await financeAssignments(schoolId)));
  }
  const identities=[...emails],accounts=await Promise.all(identities.map(email=>getTenantLineRecipient(schoolId,email,botUserId)));
  const recipients=new Map();
  accounts.forEach((account,index)=>{
    const userId=account?.lineUserId;if(!/^U[0-9a-f]{32}$/i.test(userId||"")||recipients.has(userId))return;
    const contact=account.googleEmail||identities[index];
    recipients.set(userId,{userId,name:String(account.displayName||(!String(contact).endsWith("@line.invalid")&&contact)||"LINE 登入帳號").slice(0,80)});
  });
  return {
    targets:[...recipients.keys()].sort(),recipients:[...recipients.values()].sort((a,b)=>a.userId.localeCompare(b.userId)),
    unbound:accounts.filter(account=>!/^U[0-9a-f]{32}$/i.test(account?.lineUserId||"")).length,
    matched:emails.size,
    contacts:identities.map((email,index)=>({email,userId:/^U[0-9a-f]{32}$/i.test(accounts[index]?.lineUserId||"")?accounts[index].lineUserId:""}))
  };
}
