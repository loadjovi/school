// Small, student-scoped learning goals. Stored on the existing private lesson record.
export const MAX_WEEKLY_GOALS=3;
export const MAX_GOAL_LENGTH=120;
export function normalizeWeeklyGoals(raw){
  if(!Array.isArray(raw))return {error:"每週練習目標必須為清單"};
  if(raw.length>MAX_WEEKLY_GOALS)return {error:"每堂個課最多設定 3 項練習建議"};
  const goals=[];
  for(const value of raw){
    if(typeof value!=="string")return {error:"練習建議內容格式錯誤"};
    const goal=value.trim();
    if(goal.length>MAX_GOAL_LENGTH)return {error:"每項練習建議最多 120 字"};
    if(goal&&!goals.includes(goal))goals.push(goal);
  }
  return {goals};
}
export function readWeeklyGoals(raw){
  if(Array.isArray(raw))return normalizeWeeklyGoals(raw).goals||[];
  try{return normalizeWeeklyGoals(JSON.parse(String(raw||"[]"))).goals||[]}catch{return []}
}
export function isPublishedLesson(e){
  const status=String(e?.status||"");
  return status==="teacher_completed"||
    (["present","late"].includes(status)&&String(e?.parentConfirmation||"")==="confirmed");
}
export function withinGoalWindow(lessonDate,practiceDate,days=14){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(lessonDate||""))||!/^\d{4}-\d{2}-\d{2}$/.test(String(practiceDate||"")))return false;
  const begin=Date.parse(String(lessonDate)+"T00:00:00Z"),end=Date.parse(String(practiceDate)+"T00:00:00Z");
  return Number.isFinite(begin)&&Number.isFinite(end)&&end>=begin&&end-begin<=days*86400000;
}
