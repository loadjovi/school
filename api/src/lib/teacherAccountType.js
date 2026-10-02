// Account type is chosen by the school admin, independent of course selections.
// Older directory rows have no account type and remain general teachers.
export const isPrivateOnlyTeacher=directory=>directory?.privateOnly===true;

export function teacherCourseAccess(directory,profile){
  const privateOnly=isPrivateOnlyTeacher(directory);
  const sectionAssignments=privateOnly?[]:profile.sectionAssignments;
  const ensembleGroups=privateOnly?[]:profile.ensembleGroups;
  const comprehensiveEnabled=!privateOnly&&profile.comprehensiveEnabled===true;
  const privateStudentIds=profile.privateStudentIds;
  const role=privateOnly?"privateTeacher":sectionAssignments.length?"sectionTeacher":ensembleGroups.length?"ensembleTeacher":comprehensiveEnabled?"comprehensiveTeacher":"teacher";
  return {privateOnly,sectionAssignments,ensembleGroups,comprehensiveEnabled,privateStudentIds,role};
}
