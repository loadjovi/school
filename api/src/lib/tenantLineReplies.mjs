import {tenantLineParentStudents} from "./tenantLineMenu.js";
import {listByStudent, listTenantRolesByEmail} from "./storage.js";
import {calendarEventsForStudent, listCalendarEvents} from "../functions/calendarEvents.js";
import {resolveSchoolCourses} from "../functions/schoolSchedule.js";
import {isTrainingEventType} from "./trainingEventTypes.js";
import {formatLineTodayCourses, isTodayCoursesCommand, uniquePrivateLessons} from "./lineTodayCoursesFormat.mjs";
import {formatLineActivityCalendar, isActivityCalendarCommand, uniqueActivityEvents} from "./lineActivityCalendarFormat.mjs";
import {formatLineLatestAnnouncements, isLatestAnnouncementsCommand, isImportantAnnouncement, uniqueAnnouncementEvents} from "./lineLatestAnnouncementsFormat.mjs";
import {buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards} from "./lineReplyCards.mjs";

const taipeiDate = date => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
}).format(date);

export function tenantLineReplyKind(text) {
  if (isTodayCoursesCommand(text)) return "today";
  if (isActivityCalendarCommand(text)) return "calendar";
  if (isLatestAnnouncementsCommand(text)) return "announcements";
  return "";
}

export function tenantLineStaffReplyKind(text) {
  const command = String(text || "").trim();
  if (command === "#幹部今日課程") return "today";
  if (command === "#幹部活動行事曆") return "calendar";
  if (command === "#幹部最新公告") return "announcements";
  return "";
}

function formatReply(kind,input,cards){
  if(cards)return kind==="today"?buildTodayCourseCards(input):kind==="calendar"?buildActivityCalendarCards(input):buildLatestAnnouncementCards(input);
  return kind==="today"?formatLineTodayCourses(input):kind==="calendar"?formatLineActivityCalendar(input):formatLineLatestAnnouncements(input);
}

export async function tenantLineStaffReply(kind, schoolId, account, now = new Date(), {cards=false} = {}) {
  if (!account?.googleEmail) {
    return "此 LINE 帳號尚未完成本校 LINE 與 Gmail 配對。\n請以原本的 Gmail 登入平台，再到「LINE 通知中心 → 我的 LINE 綁定」，完成授權後核對帳號並按「確認綁定」。";
  }
  const roles = await listTenantRolesByEmail(account.googleEmail, "active");
  if (!roles.some(role => role.role === "schoolAdmin" && role.schoolId === schoolId)) {
    return "目前綁定的 Gmail 尚無本校學校管理員權限。\n請由 Global 管理員核對綁定的 Gmail 與本校 School Admin 指派。";
  }
  const date = taipeiDate(now);
  if (kind === "today") {
    const [schedules, events] = await Promise.all([
      resolveSchoolCourses(schoolId, date), listCalendarEvents(schoolId, date, date)
    ]);
    const training = events.filter(row => isTrainingEventType(row.eventType));
    return formatReply("today",{date, schoolWide: true, students: [{schedules, training}]},cards);
  }
  const days = kind === "calendar" ? 30 : 90;
  const toDate = taipeiDate(new Date(now.getTime() + days * 86400000));
  const events = await listCalendarEvents(schoolId, date, toDate);
  if (kind === "calendar") return formatReply("calendar",{fromDate: date, toDate, schoolWide: true, events},cards);
  return formatReply("announcements",{fromDate: date, schoolWide: true,
    events: events.filter(row => row.visibleToParents !== false && isImportantAnnouncement(row))},cards);
}

export async function tenantLineParentReply(kind, schoolId, account, now = new Date(), {cards=false} = {}) {
  if (!account) return "請先使用此校 LINE 登入並綁定家長帳號。";
  const students = await tenantLineParentStudents(schoolId, account.parentEmail);
  if (!students.length) return "此校尚無已核准的學生綁定。";
  const date = taipeiDate(now);
  if (kind === "today") {
    const items = await Promise.all(students.map(async student => {
      const [schedules, events, privateLessons] = await Promise.all([
        resolveSchoolCourses(schoolId, date, student),
        calendarEventsForStudent(schoolId, date, date, student),
        listByStudent("privateLesson", student.studentId, date, date, schoolId)
      ]);
      return {student, schedules, training: events.filter(row => isTrainingEventType(row.eventType)),
        privateLessons: uniquePrivateLessons(privateLessons)};
    }));
    return formatReply("today",{date, students: items},cards);
  }
  const days = kind === "calendar" ? 30 : 90;
  const toDate = taipeiDate(new Date(now.getTime() + days * 86400000));
  const rows = await Promise.all(students.map(student => calendarEventsForStudent(schoolId, date, toDate, student)));
  const groups = students.map(student => student.groupName);
  const events = rows.flat().map(row => ({...row, schoolId}));
  if (kind === "calendar") return formatReply("calendar",{
    fromDate: date, toDate, groups, events: uniqueActivityEvents(events)
  },cards);
  return formatReply("announcements",{
    fromDate: date, groups, events: uniqueAnnouncementEvents(events.filter(isImportantAnnouncement))
  },cards);
}
