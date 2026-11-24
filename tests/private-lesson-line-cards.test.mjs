import test from "node:test";
import assert from "node:assert/strict";
import {buildPrivateLessonNoticeCard,buildPrivatePracticeCard,buildPrivateReviewResponseCard} from "../api/src/lib/privateLessonLineCards.mjs";
import {normalizeLineReplyMessage} from "../api/src/lib/lineMessaging.mjs";

const notice={schoolId:"school-a",studentName:"測試學生",teacherName:"名冊老師",lessonDate:"2026-11-24",startTime:"18:00",endTime:"18:50",minutes:50,
 lessonContent:"音階換把與節奏練習",weeklyPracticeGoals:["分段慢練","穩定節拍","聽辨音準"],previousDate:"2026-11-23",previousStartTime:"17:00",previousEndTime:"17:50",reason:"老師調整時段",note:"家長回報時間需要核對"};
const code="ABCDEF12345678",appUrl="https://school.example.invalid/",fallbackText="原純文字通知與平台網址";
function nodes(value){return !value||typeof value!=="object"?[]:[value,...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(nodes):nodes(item))]}
const visible=message=>nodes(message.contents).filter(node=>node.type==="text").map(node=>node.text).join("\n");
const actions=message=>nodes(message.contents).filter(node=>["uri","postback"].includes(node.type));

test("each course event clearly identifies the family, teacher, date, time and a valid school-scoped next step",()=>{
 for(const eventType of ["scheduled","rescheduled","cancelled","completed","confirmed","issue"]){
  const message=buildPrivateLessonNoticeCard({notice:{...notice,eventType},appUrl,fallbackText});
  assert.equal(message.type,"flex");const body=visible(message);
  for(const expected of [notice.studentName,notice.teacherName,notice.lessonDate,"18:00～18:50"])assert.ok(body.includes(expected),eventType+":"+expected);
  assert.doesNotMatch(body,/https:\/\//);assert.ok(message.altText.includes(notice.lessonDate));assert.ok(message.altText.includes("18:00"));
  const links=actions(message);assert.equal(links.length,1);assert.equal(links[0].type,"uri");
  const url=new URL(links[0].uri);assert.equal(url.origin,"https://school.example.invalid");assert.equal(url.searchParams.get("schoolId"),"school-a");
  assert.ok(links[0].label.length>2);assert.equal(message.fallbackText,fallbackText);
  assert.equal(normalizeLineReplyMessage(message).type,"flex");
 }
});

test("reschedule, cancellation and parent issue cards keep the changed time and reasons distinct",()=>{
 const changed=visible(buildPrivateLessonNoticeCard({notice:{...notice,eventType:"rescheduled"},appUrl}));
 for(const value of ["新上課日期","新上課時間","原上課時間","2026-11-23","17:00～17:50",notice.reason])assert.ok(changed.includes(value));
 const cancelled=visible(buildPrivateLessonNoticeCard({notice:{...notice,eventType:"cancelled"},appUrl}));
 assert.match(cancelled,/已停課/);assert.match(cancelled,/停課原因/);assert.ok(cancelled.includes(notice.reason));
 const issue=visible(buildPrivateLessonNoticeCard({notice:{...notice,eventType:"issue"},appUrl}));assert.ok(issue.includes(notice.note));assert.match(issue,/待老師核對/);
});

test("completed cards keep all goals and provide exactly five personal review drafts without showing the code in the main text",()=>{
 const message=buildPrivateLessonNoticeCard({notice:{...notice,eventType:"completed"},entity:{actualAttendanceStatus:"late"},appUrl,reviewCode:code,reviewExpiresAt:Date.parse("2026-12-01T12:00:00Z"),fallbackText});
 const body=visible(message);assert.ok(body.includes(notice.lessonContent));for(const goal of notice.weeklyPracticeGoals)assert.ok(body.includes(goal));
 assert.match(body,/遲到/);assert.match(body,/加上評語/);assert.match(body,/未送出不會儲存/);assert.match(body,/12\/01/);
 assert.doesNotMatch(body,new RegExp(code));assert.doesNotMatch(body,/#個課評鑑/);
 const stars=actions(message).filter(action=>action.type==="postback");assert.equal(stars.length,5);
 stars.forEach((action,index)=>{assert.equal(action.label,`${index+1} 星`);assert.equal(action.data,`lesson-review:${code}:${index+1}`);assert.equal(action.inputOption,"openKeyboard");assert.equal(action.fillInText,`#個課評鑑 ${code} ${index+1} `)});
 const noCode=buildPrivateLessonNoticeCard({notice:{...notice,eventType:"completed"},appUrl,reviewCode:"foreign-or-invalid"});assert.equal(actions(noCode).filter(action=>action.type==="postback").length,0);
});

test("a saved review receipt distinguishes teacher stars, parent comments and confirmed completion",()=>{
 const review="老師耐心示範，孩子更能掌握節奏。",message=buildPrivateReviewResponseCard({text:"已確認並記錄回饋",receipt:{date:notice.lessonDate,startTime:notice.startTime,endTime:notice.endTime,rating:4,review},appUrl});
 const body=visible(message);assert.match(body,/給老師的教學星等/);assert.match(body,/★★★★☆（4\/5）/);assert.ok(body.includes(review));
 assert.match(body,/本堂個課已確認完成/);assert.match(body,/不需再回網頁確認/);
 const hint=buildPrivateReviewResponseCard({text:`請輸入指令＋代碼，保留指令與代碼 #個課評鑑 ${code} 5 請填寫您的想法`,appUrl});
 assert.match(visible(hint),/請補上教學評語/);assert.doesNotMatch(visible(hint),new RegExp(code));
});

test("practice cards retain date, minutes, goal, notes and the exact permitted lesson link",()=>{
 const url=appUrl+"?schoolId=school-a&practiceLesson=lesson-one&practiceStudent=student-one";
 const message=buildPrivatePracticeCard({studentName:notice.studentName,practiceDate:notice.lessonDate,minutes:103,goalText:"12–34 換把位",practiceNote:"慢練兩次",lessonDate:"2026-11-19",url,fallbackText});
 const body=visible(message);for(const value of ["103 分鐘","12–34 換把位","慢練兩次","2026-11-19","不代表已熟練"])assert.ok(body.includes(value));
 assert.equal(actions(message)[0].uri,url);assert.doesNotMatch(body,/https:\/\//);assert.ok(message.altText.includes("103"));
});

test("long content remains within provider limits, scales and wraps without hiding required dates or review comments",()=>{
 const message=buildPrivateLessonNoticeCard({notice:{...notice,eventType:"completed",studentName:"姓".repeat(120),lessonContent:"練".repeat(2000),weeklyPracticeGoals:Array(3).fill("琴".repeat(120))},appUrl,reviewCode:code,fallbackText});
 assert.equal(message.type,"flex");assert.ok(Buffer.byteLength(JSON.stringify(message.contents))<29000);
 assert.ok(visible(message).includes(notice.lessonDate));assert.ok(visible(message).includes("練".repeat(2000)));
 for(const node of nodes(message.contents).filter(node=>node.type==="text")){assert.equal(node.wrap,true);assert.equal(node.scaling,true);assert.equal(node.maxLines,undefined)}
 const receipt=buildPrivateReviewResponseCard({text:"已完成",receipt:{date:notice.lessonDate,rating:5,review:"評".repeat(800)}});assert.ok(visible(receipt).includes("評".repeat(800)));
});

test("invalid web links are omitted, and production or LAB headings follow only the explicit environment flag",()=>{
 for(const appUrl of ["javascript:alert(1)","http://example.invalid/","https://user:pass@example.invalid/"]){
  const message=buildPrivateLessonNoticeCard({notice:{...notice,eventType:"scheduled"},appUrl});assert.equal(actions(message).length,0);
 }
 const production=buildPrivatePracticeCard({studentName:"學生",practiceDate:notice.lessonDate});assert.doesNotMatch(visible(production),/LAB/);
 const lab=buildPrivatePracticeCard({studentName:"學生",practiceDate:notice.lessonDate,lab:true});assert.match(visible(lab),/LAB｜/);assert.match(lab.altText,/【LAB】/);
});
