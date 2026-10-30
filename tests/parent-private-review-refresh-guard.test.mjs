import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../app/private-lesson-confirmation.js",import.meta.url),"utf8");
function part(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from);
  assert.ok(from>=0&&to>from,"missing segment: "+start);
  return source.slice(from,to);
}
const code=[
  "let privatePoll=null;",
  part("  // Local unsent drafts","  const workflowText"),
  part("  function parentReviewControls(x){","  function parentLessonRow(x){"),
  part("  function startPrivatePoll(){","  function teacherHistoryHtml(){"),
  part("  window.rememberPrivateLessonReview=","  function parentActivePanel("),
  "this.exposed={isParentReviewEditing,startPrivatePoll,parentReviewControls,parentReviewDrafts};"
].join("\n");

function harness(){
  const row={lessonId:"oct29",studentId:"s1",workflowStatus:"awaiting_parent",teacherRating:0,teacherReview:"",updatedAt:"0"};
  const state={me:{role:"parent"},student:{studentId:"s1"},page:"home",privateLessons:[row]};
  const inputs=new Map([["rating_oct29",{value:"0"}],["review_oct29",{value:"",focus(){}}]]);
  const stars=Array.from({length:5},(_,i)=>({dataset:{starValue:String(i+1)},textContent:"☆",setAttribute(k,v){this[k]=v}}));
  const document={hidden:false,activeElement:null,getElementById:id=>inputs.get(id)||null,querySelectorAll:()=>stars};
  const callbacks=[],requests=[];
  let renders=0,fetches=0,apiFailure=false;
  const context={
    state,document,window:{},setInterval:fn=>{callbacks.push(fn);return callbacks.length},
    clearInterval:()=>{},lessonDomKey:x=>x,workflow:x=>x.workflowStatus,
    esc:x=>String(x??""),toast:()=>{},notifyToast:()=>{},prompt:()=>"",
    render:()=>{renders++},
    lessonSignature:()=>JSON.stringify(state.privateLessons.map(x=>x.updatedAt)),
    loadPrivateLessons:async()=>{fetches++;row.updatedAt=String(fetches)},
    api:async(_path,args)=>{requests.push(JSON.parse(args.body));if(apiFailure)throw Error("network");row.workflowStatus="completed";return {ok:true}}
  };
  vm.createContext(context);
  vm.runInContext(code,context);
  return {context,state,row,inputs,stars,requests,callbacks,get api(){return context.window},
    get rendered(){return renders},get fetched(){return fetches},
    failApi:v=>apiFailure=v};
}

test("30-second parent refresh runs normally when feedback has not been edited",async()=>{
  const h=harness();h.context.exposed.startPrivatePoll();
  assert.equal(h.callbacks.length,1);
  await h.callbacks[0]();
  assert.equal(h.fetched,1);
  assert.equal(h.rendered,1);
});

test("selected five stars and typed comment pause polling, and survive unrelated redraw",async()=>{
  const h=harness(),api=h.api;h.context.exposed.startPrivatePoll();
  api.setPrivateLessonRating("oct29",5);
  h.inputs.get("review_oct29").value="謝謝老師";
  api.rememberPrivateLessonReview("oct29");
  assert.equal(h.context.exposed.isParentReviewEditing(),true);
  await h.callbacks[0]();
  assert.equal(h.fetched,0);
  assert.equal(h.rendered,0);
  const html=h.context.exposed.parentReviewControls(h.row);
  assert.match(html,/id="rating_oct29" type="hidden" value="5"/);
  assert.match(html,/謝謝老師/);
  assert.equal(h.stars.filter(x=>x.textContent==="★").length,5);
});

test("just selecting stars or typing text is sufficient to protect the form",async()=>{
  const stars=harness();stars.context.exposed.startPrivatePoll();
  stars.api.setPrivateLessonRating("oct29",5);
  await stars.callbacks[0]();
  assert.equal(stars.fetched,0);
  const text=harness();text.context.exposed.startPrivatePoll();
  text.inputs.get("review_oct29").value="課後練習";
  text.api.rememberPrivateLessonReview("oct29");
  await text.callbacks[0]();
  assert.equal(text.fetched,0);
});

test("a fetch already in flight must not redraw when parent begins editing",async()=>{
  const h=harness();h.context.exposed.startPrivatePoll();
  let release;
  h.context.loadPrivateLessons=()=>new Promise(resolve=>{release=()=>{h.row.updatedAt="new";resolve()}});
  const polling=h.callbacks[0]();
  h.api.setPrivateLessonRating("oct29",5);
  h.inputs.get("review_oct29").value="正在輸入";
  h.api.rememberPrivateLessonReview("oct29");
  release();await polling;
  assert.equal(h.rendered,0);
  assert.match(h.context.exposed.parentReviewControls(h.row),/正在輸入/);
});

test("an edited textarea in focus also blocks redraw even before any input event",async()=>{
  const h=harness();h.context.exposed.startPrivatePoll();
  h.context.document.activeElement={id:"review_oct29"};
  await h.callbacks[0]();
  assert.equal(h.fetched,0);
});

test("draft is only discarded after successful parent confirmation; failure retains stars and comment",async()=>{
  const h=harness();h.api.setPrivateLessonRating("oct29",5);
  h.inputs.get("review_oct29").value="謝謝老師";
  h.api.rememberPrivateLessonReview("oct29");
  h.failApi(true);
  await h.api.confirmPrivateLesson("oct29","confirmed");
  assert.match(h.context.exposed.parentReviewControls(h.row),/謝謝老師/);
  assert.equal(h.context.exposed.parentReviewDrafts.size,1);
  h.failApi(false);
  await h.api.confirmPrivateLesson("oct29","confirmed");
  assert.equal(h.requests.at(-1).teacherRating,5);
  assert.equal(h.requests.at(-1).teacherReview,"謝謝老師");
  assert.equal(h.context.exposed.parentReviewDrafts.size,0);
  assert.equal(h.row.workflowStatus,"completed");
  assert.ok(h.rendered>=1);
});

test("template binds text edits to draft capture",()=>{
  assert.match(source,/oninput="rememberPrivateLessonReview/);
  assert.match(source,/isParentReviewEditing\(\)\)return/);
  assert.match(source,/before!==lessonSignature\(\)&&!isParentReviewEditing\(\)/);
});
