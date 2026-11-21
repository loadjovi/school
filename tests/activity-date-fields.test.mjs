import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../app/uniform-event-admin.html",import.meta.url),"utf8");
const controller=html.slice(html.indexOf('(()=>{\n const form=document.getElementById("config")'),html.lastIndexOf('</script>'));
function fixture(module="calendarActivity",stored={}){
 const elements={},alerts=[],listeners={};
 const control=(value="")=>({value,hidden:false,disabled:false,required:false,min:"",textContent:"",style:{},handlers:{},
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn)},emit(type){for(const fn of this.handlers[type]||[])fn({target:this})},
  closest(){return this.label??=(control())},insertAdjacentElement(_,element){elements[element.id]=element;elements.fieldTripStartDate=control();elements.fieldTripEndDate=control()}});
 const ids=["config","configModule","existingActivity","activityDateMode","singleActivityDateFields","singleActivityDate","singleActivityStartTime","singleActivityEndTime","activityStartDateTimeWrap","activityEndDateTimeWrap","activityDateModeHint","calendarDateMode","calendarEndDateWrap","calendarDateModeHint","calendarDateLabel","calendarExampleCompetition","calendarExampleChristmas","configSaveFeedback"];
 for(const id of ids)elements[id]=control();
 elements.configModule.value=module;elements.activityDateMode.value="single";elements.calendarDateMode.value="single";
 elements.config.elements=Object.fromEntries(["startAt","endAt","eventDate","endDate","startTime","endTime","eventType","calendarTitle","calendarTargetGroups","calendarLocation","timeLabel","note"].map(name=>[name,control(stored[name]||"")]));
 const context={document:{getElementById:id=>elements[id],createElement:()=>control()},window:{addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn)},dispatchEvent:event=>{for(const fn of listeners[event.type]||[])fn(event)}},queueMicrotask:fn=>fn(),alert:text=>alerts.push(text),Date,Event:class{constructor(type){this.type=type}}};
 runInNewContext(controller,context);
 return {elements,form:elements.config,alerts,context,load(){context.window.dispatchEvent({type:"activityDatesLoaded"})},submit(){const event={prevented:false,stopped:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};for(const fn of elements.config.handlers.submit)fn(event);return event}};
}

test("a calendar announcement ignores stale hidden paid-event dates and times when saving",()=>{
 const f=fixture("calendarActivity",{eventDate:"2026-12-09",endDate:"2026-12-10",startAt:"2026-12-18T12:00",endAt:"2026-12-18T12:00"});
 assert.equal(f.submit().prevented,false);assert.deepEqual(f.alerts,[]);
 assert.equal(f.form.elements.eventDate.value,"2026-12-09");assert.equal(f.form.elements.endDate.value,"2026-12-10");
});

test("single-day announcements hide and disable the end date; cross-day requires a later date",()=>{
 const f=fixture("calendarActivity",{eventDate:"2026-12-31"}),{elements,form}=f;
 assert.equal(elements.calendarDateMode.value,"single");assert.equal(elements.calendarEndDateWrap.hidden,true);
 assert.equal(form.elements.endDate.disabled,true);assert.equal(form.elements.endDate.required,false);
 elements.calendarDateMode.value="multi";elements.calendarDateMode.emit("change");
 assert.equal(elements.calendarEndDateWrap.hidden,false);assert.equal(form.elements.endDate.disabled,false);assert.equal(form.elements.endDate.required,true);
 assert.equal(form.elements.endDate.min,"2027-01-01");assert.equal(elements.calendarDateLabel.textContent,"開始日期");
 assert.equal(f.submit().prevented,true);
 form.elements.endDate.value="2026-12-31";assert.equal(f.submit().prevented,true);
 form.elements.endDate.value="2026-12-30";assert.equal(f.submit().prevented,true);
 form.elements.endDate.value="2027-01-01";assert.equal(f.submit().prevented,false);
 elements.calendarDateMode.value="single";elements.calendarDateMode.emit("change");
 assert.equal(elements.calendarEndDateWrap.hidden,true);assert.equal(form.elements.endDate.value,"");assert.equal(form.elements.endDate.disabled,true);assert.equal(form.elements.endDate.required,false);
 assert.equal(f.submit().prevented,false);
});

test("stored cross-day and same-day announcements choose the appropriate visible date controls",()=>{
 const f=fixture("calendarActivity",{eventDate:"2026-12-09",endDate:"2026-12-10",startTime:"23:00",endTime:"01:00"});
 assert.equal(f.elements.calendarDateMode.value,"multi");assert.equal(f.elements.calendarEndDateWrap.hidden,false);assert.equal(f.submit().prevented,false);
 f.form.elements.endDate.value="2026-12-09";f.form.elements.startTime.value="09:00";f.form.elements.endTime.value="10:00";f.load();
 assert.equal(f.elements.calendarDateMode.value,"single");assert.equal(f.elements.calendarEndDateWrap.hidden,true);assert.equal(f.form.elements.endDate.disabled,true);
 assert.equal(f.submit().prevented,false);f.form.elements.endTime.value="08:00";assert.equal(f.submit().prevented,true);
 assert.match(f.alerts.at(-1),/跨午夜請選「跨日活動」/);
});

test("switching between calendar and registration events isolates date synchronization and hidden constraints",()=>{
 const f=fixture("fieldTrip",{startAt:"2026-12-18T12:00",endAt:"2026-12-18T12:00",eventDate:"2026-12-09",endDate:"2026-12-10"});
 assert.equal(f.form.elements.endDate.required,false);assert.equal(f.form.elements.endDate.disabled,true);
 const before=[f.form.elements.startAt.value,f.form.elements.endAt.value];
 f.elements.configModule.value="calendarActivity";f.elements.configModule.emit("change");
 assert.equal(f.elements.calendarDateMode.value,"multi");assert.equal(f.submit().prevented,false);
 assert.deepEqual([f.form.elements.startAt.value,f.form.elements.endAt.value],before);
 f.elements.configModule.value="fieldTrip";f.elements.configModule.emit("change");
 assert.equal(f.form.elements.endDate.required,false);assert.equal(f.form.elements.endDate.disabled,true);assert.equal(f.submit().prevented,false);
 assert.equal(f.elements.singleActivityStartTime.closest().hidden,true);
});

test("registration day ranges still serialize as date-only noon values and dinners still validate their times",()=>{
 const f=fixture("fieldTrip",{startAt:"2026-12-09T12:00",endAt:"2026-12-10T12:00"});
 assert.equal(f.elements.activityDateMode.value,"multi");assert.equal(f.elements.fieldTripDateRange.hidden,false);
 f.elements.fieldTripStartDate.value="2026-12-11";f.elements.fieldTripStartDate.emit("input");f.elements.fieldTripEndDate.value="2026-12-12";f.elements.fieldTripEndDate.emit("input");
 assert.equal(f.form.elements.startAt.value,"2026-12-11T12:00");assert.equal(f.form.elements.endAt.value,"2026-12-12T12:00");assert.equal(f.submit().prevented,false);
 const dinner=fixture("yearEndDinner",{startAt:"2026-12-18T17:00",endAt:"2026-12-18T20:00",eventDate:"2026-11-30",endDate:"2026-12-04"});
 assert.equal(dinner.elements.activityDateMode.value,"single");assert.equal(dinner.elements.activityDateMode.disabled,true);assert.equal(dinner.form.elements.endDate.required,false);
 assert.equal(dinner.submit().prevented,false);dinner.elements.singleActivityEndTime.value="16:00";assert.equal(dinner.submit().prevented,true);
});

test("competition and performance examples synchronize the visible single/cross-day selection immediately",()=>{
 const f=fixture(),source=readFileSync(new URL("../app/uniform-event-admin.js",import.meta.url),"utf8");
 Object.assign(f.context,{el:id=>f.elements[id],updateActivityAudiencePreview(){},confirm:()=>true});
 const start=source.indexOf("const calendarExamples="),end=source.indexOf("\nsyncConfig();",start);
 runInNewContext(source.slice(start,end),f.context);
 f.elements.calendarExampleCompetition.emit("click");assert.equal(f.elements.calendarDateMode.value,"multi");assert.equal(f.elements.calendarEndDateWrap.hidden,false);
 assert.equal(f.form.elements.endDate.value,"2026-12-04");assert.equal(f.submit().prevented,false);
 f.elements.calendarExampleChristmas.emit("click");assert.equal(f.elements.calendarDateMode.value,"single");assert.equal(f.elements.calendarEndDateWrap.hidden,true);
 assert.equal(f.form.elements.endDate.value,"");assert.equal(f.submit().prevented,false);
});
