import {getLineAccountBindingsByUserId} from "./lineAccountBinding.js";
import {getMappedStudentsByEmail} from "./storage.js";
import {calendarEventsForStudent} from "../functions/calendarEvents.js";
import {formatLineActivityCalendar,isActivityCalendarCommand,uniqueActivityEvents} from "./lineActivityCalendarFormat.mjs";

export {formatLineActivityCalendar,isActivityCalendarCommand} from "./lineActivityCalendarFormat.mjs";

const taipeiDate=date=>new Intl.DateTimeFormat("en-CA",{
  timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"
}).format(date);

export async function lineActivityCalendarReply(lineUserId,{now=new Date(),days=30}={}){
  const bindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:false});
  if(!bindings.length)return "目前 LINE 尚未連結平台帳號，請先點選「開啟／綁定平台」完成綁定。";
  const fromDate=taipeiDate(now),until=new Date(now.getTime()+Math.max(1,Number(days)||30)*86400000),toDate=taipeiDate(until);
  const identities=[];
  for(const binding of bindings){
    const students=await getMappedStudentsByEmail(binding.parentEmail,binding.schoolId);
    for(const student of students)identities.push({schoolId:binding.schoolId,student});
  }
  if(!identities.length)return "目前帳號沒有已核准並綁定的學生，因此無法查詢活動行事曆。";
  const eventLists=await Promise.all(identities.map(async({schoolId,student})=>(
    await calendarEventsForStudent(schoolId,fromDate,toDate,student)
  ).map(row=>({...row,schoolId}))));
  return formatLineActivityCalendar({
    fromDate,toDate,
    groups:identities.map(item=>item.student.groupName),
    events:uniqueActivityEvents(eventLists.flat())
  });
}
