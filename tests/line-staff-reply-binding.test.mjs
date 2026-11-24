import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../api/src/lib/tenantLineReplies.mjs",import.meta.url),"utf8")
  .replace(/^import\s+[\s\S]*?;\r?\n/gm,"").replace(/^export /gm,"");
const now=new Date("2026-11-24T06:00:00Z"),email="staff@example.test",kinds=["today","calendar","announcements"];

function fixture(roles=[]){
  const roleReads=[],schoolReads=[];
  const api=runInNewContext(source+";({tenantLineStaffReply})",{
    listTenantRolesByEmail:async(value,status)=>{roleReads.push({email:value,status});return roles},
    resolveSchoolCourses:async school=>{schoolReads.push({kind:"courses",school});return []},
    listCalendarEvents:async school=>{schoolReads.push({kind:"events",school});return []},
    isTrainingEventType:()=>false,isImportantAnnouncement:()=>true,
    formatLineTodayCourses:args=>({kind:"today",...args}),
    formatLineActivityCalendar:args=>({kind:"calendar",...args}),
    formatLineLatestAnnouncements:args=>({kind:"announcements",...args})
  });
  return {roleReads,schoolReads,reply:(kind,account)=>api.tenantLineStaffReply(kind,"school-a",account,now)};
}

test("old staff menu visibility and pending or missing LINE/Gmail identity never authorize school queries",async()=>{
  for(const account of [null,{}, {lineUserId:"old-user",richMenuId:"old-staff-menu"},
    {lineUserId:"pending-user",pendingLink:{googleEmail:email}}, {lineUserId:"pending-user",googleEmail:""}]){
    const h=fixture([{role:"schoolAdmin",schoolId:"school-a"}]);
    for(const kind of kinds){
      const result=await h.reply(kind,account);
      assert.match(result,/尚未完成本校 LINE 與 Gmail 配對/);
      assert.match(result,/以原本的 Gmail 登入/);
      assert.match(result,/我的 LINE 綁定/);assert.match(result,/確認綁定/);
    }
    assert.equal(h.roleReads.length,0);assert.equal(h.schoolReads.length,0);
  }
});

test("a linked Gmail without this school's administrator role gets a separate denial before any school data read",async()=>{
  for(const roles of [[],[{role:"teacher",schoolId:"school-a"}],
    [{role:"schoolAdmin",schoolId:"school-b"}],[{role:"globalAdmin",schoolId:"*"}]]){
    const h=fixture(roles),account={googleEmail:email,lineUserId:"confirmed-user"};
    for(const kind of kinds){
      const result=await h.reply(kind,account);
      assert.match(result,/綁定的 Gmail 尚無本校學校管理員權限/);
      assert.match(result,/Global 管理員/);assert.doesNotMatch(result,/尚未完成.*配對/);
    }
    assert.deepEqual(h.roleReads,kinds.map(()=>({email,status:"active"})));
    assert.equal(h.schoolReads.length,0);
  }
});

test("confirmed same-school administrators retain all three read-only staff replies",async()=>{
  const h=fixture([{role:"teacher",schoolId:"school-b"},{role:"schoolAdmin",schoolId:"school-a"}]);
  for(const kind of kinds){
    const result=await h.reply(kind,{googleEmail:email,lineUserId:"confirmed-user"});
    assert.equal(result.kind,kind);assert.equal(result.schoolWide,true);
  }
  assert.deepEqual(h.schoolReads,[{kind:"courses",school:"school-a"},{kind:"events",school:"school-a"},
    {kind:"events",school:"school-a"},{kind:"events",school:"school-a"}]);
});
