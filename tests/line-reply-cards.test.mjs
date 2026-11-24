import test from "node:test";
import assert from "node:assert/strict";
import {buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards} from "../api/src/lib/lineReplyCards.mjs";

const date="2026-11-24",range={fromDate:date,toDate:"2026-12-24",groups:["A"]};
const cards=message=>message.contents.type==="carousel"?message.contents.contents:[message.contents];
const walk=value=>value&&typeof value==="object"?[value,...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(walk):walk(item))]:[];
const words=value=>walk(value).filter(item=>item.type==="text").map(item=>item.text).join("\n");
const size=value=>new TextEncoder().encode(JSON.stringify(value)).length;

test("today cards merge lesson types chronologically and separate title, time, group and location",()=>{
 const message=buildTodayCourseCards({date,schoolWide:true,students:[{
  schedules:[{courseName:"B團分部課",groupName:"B",startTime:"17:40",endTime:"18:30",location:"音樂教室 1/2"},
   {courseName:"A、B團合奏課",groupName:"A,B",startTime:"12:30",endTime:"13:20",location:"A／B 團練教室區"}],
  training:[{title:"比賽加練",targetGroups:"A",startTime:"07:50",endTime:"08:35"}],
  privateLessons:[{teacherName:"不該出現的個課老師",startTime:"11:00"}]
 }]});
 assert.equal(message.type,"flex");assert.equal(cards(message).length,3);
 assert.deepEqual(cards(message).map(card=>card.body.contents[0].text),["比賽加練","A、B團合奏課","B團分部課"]);
 assert.match(words(message.contents),/12:30–13:20/);assert.match(words(message.contents),/A團、B團/);
 assert.match(words(message.contents),/音樂教室 1\/2/);assert.match(message.altText,/幹部｜全校/);
 assert.doesNotMatch(words(message.contents),/個課老師/);assert.match(message.fallbackText,/今日課程/);
});

test("parent today cards retain student scope, cancellation reason and private lesson status",()=>{
 const message=buildTodayCourseCards({date,students:[{
  student:{name:"小明",groupName:"A"},
  schedules:[{courseName:"合奏課",startTime:"12:30",effectiveStatus:"cancelled",exception:{reason:"學校考試停課"}}],
  privateLessons:[{sessionId:"lesson",startTime:"19:00",teacherName:"陳老師",status:"rescheduled",updatedAt:"2026-11-24"}]
 },{student:{name:"小華",groupName:"B"}}]});
 assert.equal(cards(message).length,2);assert.match(words(cards(message)[0].header),/小明｜A團/);
 assert.match(words(message.contents),/停課/);assert.match(words(message.contents),/學校考試停課/);
 assert.match(words(cards(message)[1]),/已改期/);assert.match(words(cards(message)[1]),/陳老師/);
 assert.match(words(cards(message)[0].footer),/今日無課程：小華/);
});

test("calendar cards deduplicate shared events and preserve long time and location fields",()=>{
 const location="基隆市表演藝術中心、成功國小、深澳國小、中山高中（實際場地待公告）",timeLabel="A 團實際比賽時間待主辦單位通知";
 const competition={schoolId:"school-a",eventDate:"2026-12-02",title:"A團全國賽",timeLabel,location,targetGroups:"A"};
 const input={...range,schoolWide:true,events:[competition,{...competition},{schoolId:"school-a",eventDate:"2026-11-30",title:"A團早自習加練",startTime:"07:50",endTime:"08:35",timeLabel:"早自習"}]};
 const before=JSON.stringify(input),message=buildActivityCalendarCards(input);
 assert.equal(cards(message).length,2);assert.equal(cards(message)[0].body.contents[0].text,"A團早自習加練");
 assert.ok(words(cards(message)[1]).includes(location));assert.ok(words(cards(message)[1]).includes(timeLabel));
 assert.match(words(cards(message)[0]),/早自習/);assert.match(words(cards(message)[0].footer),/11\/24（週二）～12\/24（週四）/);
 assert.equal(JSON.stringify(input),before);
});

test("an explicit organizer time notice supersedes nominal numeric times",()=>{
 const timeLabel="實際比賽時間待主辦單位通知";
 const message=buildActivityCalendarCards({...range,events:[{eventDate:"2026-12-02",title:"比賽",startTime:"09:00",endTime:"11:00",timeLabel}]});
 assert.match(words(message.contents),new RegExp(timeLabel));assert.doesNotMatch(words(message.contents),/09:00|11:00/);
});

test("plain time descriptions keep a valid numeric range prominent and appear separately",()=>{
 for(const timeLabel of ["早自習","上午","下午","中午","傍晚","晚上","午休"]){
  const message=buildActivityCalendarCards({...range,events:[{eventDate:"2026-11-30",title:"比賽加練",startTime:"07:50",endTime:"08:35",timeLabel}]});
  const body=cards(message)[0].body.contents,time=body.find(node=>node.type==="box"&&node.contents[0].text==="時間"),description=body.find(node=>node.type==="box"&&node.contents[0].text==="時間說明");
  assert.equal(time.contents[1].text,"07:50–08:35");assert.equal(description.contents[1].text,timeLabel);
 }
 const notice=buildActivityCalendarCards({...range,events:[{eventDate:"2026-11-30",title:"比賽加練",startTime:"07:50",endTime:"08:35",timeLabel:"上午，實際時間待通知"}]});
 assert.match(words(notice.contents),/上午，實際時間待通知/);assert.doesNotMatch(words(notice.contents),/07:50|08:35/);
});

test("announcement cards put the important notice ahead of date/time and keep full ordinary-length source notes",()=>{
 const note="請於上午 08:30 集合，穿著團 T 與黑色長褲，並攜帶樂器、譜架及水壺。";
 const message=buildLatestAnnouncementCards({...range,events:[{eventDate:"2026-12-18",title:"耶誕演出集合通知",note,startTime:"08:30",location:"校園禮堂"}]});
 const body=words(cards(message)[0].body);
 assert.ok(body.indexOf(note)<body.indexOf("日期"));assert.match(body,/重要提醒/);assert.match(body,/08:30/);assert.match(body,/校園禮堂/);
 assert.match(words(cards(message)[0].footer),/僅列重要提醒與異動/);
});

test("normal card limits are explicit and empty results are a single concise bubble",()=>{
 const events=Array.from({length:15},(_,i)=>({eventDate:"2026-12-02",title:"活動 "+i,startTime:"09:00"}));
 const calendar=buildActivityCalendarCards({...range,events}),news=buildLatestAnnouncementCards({...range,events});
 assert.equal(cards(calendar).length,8);assert.match(words(cards(calendar)[0].footer),/顯示 8 \/ 15 筆/);
 assert.equal(cards(news).length,5);assert.match(words(cards(news)[0].footer),/顯示 5 \/ 15 筆/);
 const today=buildTodayCourseCards({date,students:[{student:{name:"小明",groupName:"A"},schedules:events.map(row=>({...row,courseName:row.title}))}]});
 assert.equal(cards(today).length,12);assert.match(words(cards(today)[0].footer),/顯示 12 \/ 15 堂/);
 for(const [build,input,expected] of [[buildTodayCourseCards,{date},/今天沒有已安排的課程/],[buildActivityCalendarCards,range,/未來 30 天沒有/],[buildLatestAnnouncementCards,range,/沒有新的重要通知/]]){
  const empty=build(input);assert.equal(empty.contents.type,"bubble");assert.match(words(empty.contents),expected);
 }
});

test("long Unicode source fields stay within payload bounds, use explicit ellipsis, and never add actions or hidden clipping",()=>{
 const long="🎻".repeat(20000),events=Array.from({length:20},(_,i)=>({eventDate:"2026-12-02",title:long+i,startTime:"09:00",timeLabel:long,location:long,note:long}));
 const input={...range,date,events,students:[{student:{name:long,groupName:"A"},schedules:events.map(row=>({...row,courseName:row.title}))}]};
 for(const build of [buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards]){
  const message=build(input);assert.ok(size(message)<48000);assert.ok(Array.from(message.altText).length<=400);
  assert.match(words(message.contents),/…/);assert.match(words(cards(message)[0].footer),/顯示 \d+ \/ 20/);
  for(const card of cards(message))assert.ok(size(card)<30000);
  for(const component of walk(message.contents)){
   assert.equal(Object.hasOwn(component,"action"),false);assert.equal(Object.hasOwn(component,"uri"),false);assert.equal(Object.hasOwn(component,"maxLines"),false);
   if(component.type==="text"){
    assert.equal(component.wrap,true);
    assert.equal(component.scaling,true);
    assert.equal(Array.from(component.text).some(char=>char.length===1&&char.charCodeAt(0)>=0xD800&&char.charCodeAt(0)<=0xDFFF),false);
   }
  }
  assert.deepEqual(build(input),message);
 }
});

test("malformed optional rows and dates still produce valid nonempty text components",()=>{
 for(const build of [buildTodayCourseCards,buildActivityCalendarCards,buildLatestAnnouncementCards]){
  const message=build({date:"invalid",fromDate:"2026-02-30",toDate:"",students:[null,{}],events:[null,false,{}]});
  for(const node of walk(message.contents).filter(node=>node.type==="text"))assert.ok(typeof node.text==="string"&&node.text.length>0);
  assert.ok(size(message)<48000);
 }
});
