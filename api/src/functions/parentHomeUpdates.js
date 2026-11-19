import {app} from "@azure/functions";
import {getTenantContext,json} from "../lib/auth.js";
import {calendarEventsForStudent} from "./calendarEvents.js";
import {isImportantAnnouncement,uniqueAnnouncementEvents} from "../lib/lineLatestAnnouncementsFormat.mjs";

const localDate=date=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
app.http("parentHomeUpdates",{methods:["GET"],authLevel:"anonymous",route:"parent-home-updates",handler:async request=>{
  const context=await getTenantContext(request);if(context.error)return context.error;
  const {access,schoolId}=context;
  if(access.role!=="parent")return json({error:"僅限家長查看孩子的活動提醒"},403);
  const studentId=String(request.query.get("studentId")||"");
  const student=(access.students||[]).find(x=>String(x.studentId)===studentId);
  if(!student)return json({error:"無權查看此學生的活動"},403);
  if(!String(student.groupName||"").trim())return json({events:[],announcements:[]});
  const now=new Date(),from=localDate(now),to=localDate(new Date(now.getTime()+90*86400000));
  try{
    const rows=await calendarEventsForStudent(schoolId,from,to,student);
    const time=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
    const events=uniqueAnnouncementEvents(rows.filter(row=>row.visibleToParents!==false&&row.status!=="cancelled"&&
      ((row.endDate||row.eventDate)>from||(row.endDate||row.eventDate)===from&&(!row.endTime||row.endTime>time))));
    return {...json({events,announcements:events.filter(isImportantAnnouncement).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))).slice(0,5)}),headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}};
  }catch(error){
    console.warn("Parent home updates unavailable",{schoolId,status:error?.statusCode});
    return json({error:"活動與最新提醒暫時無法讀取，請稍後重試"},503);
  }
}});
