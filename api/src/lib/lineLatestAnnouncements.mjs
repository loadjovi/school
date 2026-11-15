import {getLineAccountBindingsByUserId} from "./lineAccountBinding.js";
import {getMappedStudentsByEmail} from "./storage.js";
import {calendarEventsForStudent} from "../functions/calendarEvents.js";
import {formatLineLatestAnnouncements,isImportantAnnouncement,uniqueAnnouncementEvents} from "./lineLatestAnnouncementsFormat.mjs";

export {formatLineLatestAnnouncements,isLatestAnnouncementsCommand} from "./lineLatestAnnouncementsFormat.mjs";

const taipeiDate=date=>new Intl.DateTimeFormat("en-CA",{
  timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"
}).format(date);

export async function lineLatestAnnouncementsReply(lineUserId,{now=new Date(),days=90}={}){
  const bindings=await getLineAccountBindingsByUserId(lineUserId,{includeTarget:false});
  if(!bindings.length)return "目前 LINE 尚未連結平台帳號，請先點選「開啟／綁定平台」完成綁定。";
  const fromDate=taipeiDate(now),until=new Date(now.getTime()+Math.max(1,Number(days)||90)*86400000),toDate=taipeiDate(until);
  const identities=[];
  for(const binding of bindings){
    const students=await getMappedStudentsByEmail(binding.parentEmail,binding.schoolId);
    for(const student of students)identities.push({schoolId:binding.schoolId,student});
  }
  if(!identities.length)return "目前帳號沒有已核准並綁定的學生，因此無法查詢最新公告。";
  const eventLists=await Promise.all(identities.map(async({schoolId,student})=>(
    await calendarEventsForStudent(schoolId,fromDate,toDate,student)
  ).map(row=>({...row,schoolId}))));
  return formatLineLatestAnnouncements({
    fromDate,
    groups:identities.map(item=>item.student.groupName),
    events:uniqueAnnouncementEvents(eventLists.flat().filter(isImportantAnnouncement))
  });
}
