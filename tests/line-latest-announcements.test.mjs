import test from "node:test";
import assert from "node:assert/strict";
import {formatLineLatestAnnouncements,isImportantAnnouncement,isLatestAnnouncementsCommand,uniqueAnnouncementEvents} from "../api/src/lib/lineLatestAnnouncementsFormat.mjs";

test("latest-announcement command accepts only the private menu query",()=>{
  assert.equal(isLatestAnnouncementsCommand("最新公告"),true);
  assert.equal(isLatestAnnouncementsCommand("#最新公告"),true);
  assert.equal(isLatestAnnouncementsCommand("查看最新公告"),false);
});

test("latest announcements include important notices but exclude ordinary calendar rows",()=>{
  assert.equal(isImportantAnnouncement({title:"A團週六加練",note:"一般加練"}),false);
  assert.equal(isImportantAnnouncement({title:"A團週六加練時間調整",note:"集合時間改為 08:30"}),true);
  assert.equal(isImportantAnnouncement({title:"耶誕演出",note:"服裝為團 T、黑長褲"}),true);
});

test("latest announcements show only supplied relevant events in date order",()=>{
  const text=formatLineLatestAnnouncements({fromDate:"2026-11-15",groups:["A"],events:[
    {schoolId:"sacred-heart",title:"耶誕演出",eventDate:"2026-12-18",timeLabel:"晚上",location:"禮堂",note:"請穿著團 T"},
    {schoolId:"sacred-heart",title:"市賽",eventDate:"2026-12-02",startTime:"09:00",location:"文化中心"}
  ]});
  assert.match(text,/最新公告｜A團/);
  assert.ok(text.indexOf("市賽")<text.indexOf("耶誕演出"));
  assert.match(text,/文化中心/);
  assert.match(text,/請穿著團 T/);
});

test("duplicate events shared by siblings are emitted once",()=>{
  const row={schoolId:"sacred-heart",title:"全團活動",eventDate:"2026-11-20",startTime:"18:00"};
  assert.equal(uniqueAnnouncementEvents([row,{...row}]).length,1);
});

test("no relevant activity has an explicit empty response",()=>{
  const text=formatLineLatestAnnouncements({fromDate:"2026-11-15",groups:["B"],events:[]});
  assert.match(text,/目前沒有新的重要通知或課程異動/);
  assert.match(text,/活動行事曆/);
});
