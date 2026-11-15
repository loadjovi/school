import test from "node:test";
import assert from "node:assert/strict";
import {LAB_RICH_MENU_AUDIENCES,labRichMenuDefinition,resolveLabRichMenuAudience} from "../scripts/lab-line-rich-menu-rules.mjs";

test("school or global administrators receive the staff menu",()=>{
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"schoolAdmin",schoolId:"sacred-heart",status:"active"}],studentCount:2}),LAB_RICH_MENU_AUDIENCES.STAFF);
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"globalAdmin",schoolId:"*",status:"active"}]}),LAB_RICH_MENU_AUDIENCES.STAFF);
});

test("a Global-assigned administrative teacher receives staff without being a parent",()=>{
  assert.equal(resolveLabRichMenuAudience({
    schoolId:"sacred-heart",
    tenantRoles:[
      {role:"teacher",schoolId:"sacred-heart",status:"active"},
      {role:"schoolAdmin",schoolId:"sacred-heart",status:"active"}
    ],
    studentCount:0,
    parentLinked:false
  }),LAB_RICH_MENU_AUDIENCES.STAFF);
});

test("teacher alone does not silently gain the staff menu",()=>{
  assert.equal(resolveLabRichMenuAudience({
    schoolId:"sacred-heart",
    tenantRoles:[{role:"teacher",schoolId:"sacred-heart",status:"active"}],
    studentCount:0,
    parentLinked:false
  }),LAB_RICH_MENU_AUDIENCES.UNBOUND);
});

test("inactive or other-school admin never upgrades the menu",()=>{
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"schoolAdmin",schoolId:"other",status:"active"}],studentCount:1}),LAB_RICH_MENU_AUDIENCES.PARENT);
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"schoolAdmin",schoolId:"sacred-heart",status:"inactive"}]}),LAB_RICH_MENU_AUDIENCES.UNBOUND);
});

test("student binding selects parent and missing binding keeps default",()=>{
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",studentCount:1}),LAB_RICH_MENU_AUDIENCES.PARENT);
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",parentLinked:true}),LAB_RICH_MENU_AUDIENCES.PARENT);
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart"}),LAB_RICH_MENU_AUDIENCES.UNBOUND);
});

test("parent menu keeps exact 2x2 bounds and LAB-only URLs",()=>{
  const menu=labRichMenuDefinition(LAB_RICH_MENU_AUDIENCES.PARENT,"https://lab.example/");
  assert.deepEqual(menu.size,{width:2500,height:1686});
  assert.equal(menu.areas.length,4);
  assert.deepEqual(menu.areas[0].action,{type:"message",label:"今日課程",text:"今日課程"});
  assert.deepEqual(menu.areas[1].action,{type:"message",label:"最新公告",text:"最新公告"});
  assert.deepEqual(menu.areas[2].action,{type:"message",label:"活動行事曆",text:"活動行事曆"});
  assert.deepEqual(menu.areas.map(x=>x.bounds),[
    {x:0,y:0,width:1250,height:843},{x:1250,y:0,width:1250,height:843},
    {x:0,y:843,width:1250,height:843},{x:1250,y:843,width:1250,height:843}
  ]);
  assert.ok(menu.areas[3].action.uri.startsWith("https://lab.example/?line_menu="));
});

test("staff menu uses exact 2x3 bounds without gaps",()=>{
  const menu=labRichMenuDefinition(LAB_RICH_MENU_AUDIENCES.STAFF,"https://lab.example/");
  assert.deepEqual(menu.size,{width:2500,height:1686});
  assert.equal(menu.areas.length,6);
  assert.deepEqual(menu.areas[0].action,{type:"message",label:"今日課程",text:"今日課程"});
  assert.deepEqual(menu.areas.map(x=>x.bounds),[
    {x:0,y:0,width:833,height:843},{x:833,y:0,width:834,height:843},{x:1667,y:0,width:833,height:843},
    {x:0,y:843,width:833,height:843},{x:833,y:843,width:834,height:843},{x:1667,y:843,width:833,height:843}
  ]);
  assert.deepEqual(menu.areas.map(x=>x.action.label),["今日課程","活動行事曆","最新公告","點名管理","待辦事項","開啟幹部平台"]);
  assert.equal(menu.areas[2].action.type,"message");
  assert.equal(menu.areas[2].action.text,"最新公告");
  assert.ok([menu.areas[1],...menu.areas.slice(3)].every(x=>x.action.uri.startsWith("https://lab.example/?line_menu=")));
});
