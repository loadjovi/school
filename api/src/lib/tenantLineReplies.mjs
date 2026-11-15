import {tenantLineParentStudents} from "./tenantLineMenu.js";
import {listByStudent, listTenantRolesByEmail} from "./storage.js";
import {calendarEventsForStudent, listCalendarEvents} from "../functions/calendarEvents.js";
import {resolveSchoolCourses} from "../functions/schoolSchedule.js";
import {isTrainingEventType} from "./trainingEventTypes.js";
import {formatLineTodayCourses, isTodayCoursesCommand, uniquePrivateLessons} from "./lineTodayCoursesFormat.mjs";
import {formatLineActivityCalendar, isActivityCalendarCommand, uniqueActivityEvents} from "./lineActivityCalendarFormat.mjs";
import {formatLineLatestAnnouncements, isLatestAnnouncementsCommand, isImportantAnnouncement, uniqueAnnouncementEvents} from "./lineLatestAnnouncementsFormat.mjs";

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

export async function tenantLineStaffReply(kind, schoolId, account, now = new Date()) {
  const roles = account?.googleEmail ? await listTenantRolesByEmail(account.googleEmail, "active") : [];
  if (!roles.some(role => role.role === "schoolAdmin" && role.schoolId === schoolId)) {
    return "此功能限本校已綁定 LINE 的學校管理員使用。";
  }
  const date = taipeiDate(now);
  if (kind === "today") {
    const [schedules, events] = await Promise.all([
      resolveSchoolCourses(schoolId, date), listCalendarEvents(schoolId, date, date)
    ]);
    const training = events.filter(row => isTrainingEventType(row.eventType));
    return formatLineTodayCourses({date, schoolWide: true, students: [{schedules, training}]});
  }
  const days = kind === "calendar" ? 30 : 90;
  const toDate = taipeiDate(new Date(now.getTime() + days * 86400000));
  const events = await listCalendarEvents(schoolId, date, toDate);
  if (kind === "calendar") return formatLineActivityCalendar({fromDate: date, toDate, schoolWide: true, events});
  return formatLineLatestAnnouncements({fromDate: date, schoolWide: true,
    events: events.filter(row => row.visibleToParents !== false && isImportantAnnouncement(row))});
}

export async function tenantLineParentReply(kind, schoolId, account, now = new Date()) {
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
    return formatLineTodayCourses({date, students: items});
  }
  const days = kind === "calendar" ? 30 : 90;
  const toDate = taipeiDate(new Date(now.getTime() + days * 86400000));
  const rows = await Promise.all(students.map(student => calendarEventsForStudent(schoolId, date, toDate, student)));
  const groups = students.map(student => student.groupName);
  const events = rows.flat().map(row => ({...row, schoolId}));
  if (kind === "calendar") return formatLineActivityCalendar({
    fromDate: date, toDate, groups, events: uniqueActivityEvents(events)
  });
  return formatLineLatestAnnouncements({
    fromDate: date, groups, events: uniqueAnnouncementEvents(events.filter(isImportantAnnouncement))
  });
}
