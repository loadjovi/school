// Shared status rule for school T-shirt roster and CSV exports.
// The StudentMaster status is authoritative: former pupils remain queryable
// for historical receipt auditing but are not current uniform recipients.
export function isCurrentTshirtStudent(student={}){
  const value=String(student.status??"active").trim().toLowerCase();
  return !value||value==="active";
}
export function tshirtRosterMembers(students=[],group="ALL",status="current"){
  const normalize=value=>{
    const x=String(value||"").trim().toUpperCase().replace(/\s/g,"");
    if(x==="A"||x==="A團")return "A";
    if(x==="B"||x==="B團")return "B";
    if(["C","C團","儲備","儲備團"].includes(x))return "C";
    return "";
  };
  return students.filter(s=>{
    const g=normalize(s.groupName||s.group);
    return !!g&&(group==="ALL"||g===group)&&
      (status==="archive"?!isCurrentTshirtStudent(s):isCurrentTshirtStudent(s));
  });
}
export function tshirtArchiveLabel(student={}){
  const reason=String(student.inactiveReason||"").trim();
  if(/畢業|graduat/i.test(reason))return "已畢業";
  if(/退團|退出|轉團|離團|leave/i.test(reason))return "已退團";
  return "已退出／停用";
}
