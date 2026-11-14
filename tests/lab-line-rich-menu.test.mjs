import test from "node:test";
import assert from "node:assert/strict";
import {LAB_RICH_MENU_AUDIENCES,labRichMenuDefinition,resolveLabRichMenuAudience} from "../scripts/lab-line-rich-menu-rules.mjs";

test("school or global administrators receive the staff menu",()=>{
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"schoolAdmin",schoolId:"sacred-heart",status:"active"}],studentCount:2}),LAB_RICH_MENU_AUDIENCES.STAFF);
  assert.equal(resolveLabRichMenuAudience({schoolId:"sacred-heart",tenantRoles:[{role:"globalAdmin",schoolId:"*",status:"active"}]}),LAB_RICH_MENU_AUDIENCES.STAFF);
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

test("role menus use exact 2x2 bounds and LAB-only URLs",()=>{
  for(const audience of [LAB_RICH_MENU_AUDIENCES.PARENT,LAB_RICH_MENU_AUDIENCES.STAFF]){
    const menu=labRichMenuDefinition(audience,"https://lab.example/");
    assert.deepEqual(menu.size,{width:2500,height:1686});
    assert.equal(menu.areas.length,4);
    assert.deepEqual(menu.areas.map(x=>x.bounds),[
      {x:0,y:0,width:1250,height:843},{x:1250,y:0,width:1250,height:843},
      {x:0,y:843,width:1250,height:843},{x:1250,y:843,width:1250,height:843}
    ]);
    assert.ok(menu.areas.every(x=>x.action.uri.startsWith("https://lab.example/?line_menu=")));
  }
});
