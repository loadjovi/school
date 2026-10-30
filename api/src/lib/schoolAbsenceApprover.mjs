// Only the designated school staff member can close an absence follow-up.
// Restrict the current Sacred Heart rule to its own school tenant.
// Other school tenants preserve their existing school-viewer policy.
const designatedBySchool=Object.freeze({"sacred-heart":"andy081005@gmail.com"});
const normalized=v=>String(v||"").trim().toLowerCase();
export function designatedSchoolAbsenceApprover(schoolId){
 return designatedBySchool[normalized(schoolId)]||"";
}
export function canConfirmSchoolAbsence(schoolId,actor){
 const required=designatedSchoolAbsenceApprover(schoolId);
 return !!normalized(actor)&&(!required||normalized(actor)===required);
}
