import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const workspace=readFileSync(new URL("../app/school-admin-workspace.js",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/admin-semester-scores.html",import.meta.url),"utf8");
const source=readFileSync(new URL("../api/src/functions/parentSemesterAttendance.js",import.meta.url),"utf8");
const studentApi=readFileSync(new URL("../api/src/functions/studentMaster.js",import.meta.url),"utf8");
test("school workspace has dedicated 20-point score overview in both mobile and desktop",()=>{
 assert.match(workspace,/grades:\['學期成績總覽'/);
 assert.match(workspace,/\['grades','學期成績總覽'/);
 assert.match(workspace,/id="awSemesterScoresFrame"/);
 assert.match(workspace,/group==='grades'/);
 assert.match(workspace,/school-semester-scores-height/);
 assert.match(page,/滿分 20 分/);
});
test("school score overview uses exact parent semester scoring API, never a second scoring algorithm",()=>{
 assert.match(page,/\/api\/parent-semester-attendance\?studentId=/);
 assert.match(page,/\/api\/student-master\?status=active/);
 assert.match(page,/sessionStorage\.getItem\("google_id_token"\)/);
 assert.match(page,/sessionStorage\.getItem\("school_context_id"\)/);
 assert.match(page,/sessionStorage\.getItem\("role_context"\)/);
 assert.match(page,/score\?\.semesterScore/);
 assert.match(page,/score\.practice10/);
 assert.match(page,/score\.attendance5/);
 assert.match(page,/score\.performance5/);
 assert.match(page,/s\.total20==null\?"待完成"/);
 assert.match(page,/已取得/);
 assert.match(source,/access\.role!=="parent"&&access\.role!=="admin"/);
 assert.match(studentApi,/if\(access\.role!=="admin"\)return json\(\{error:"Forbidden"\},403\)/);
});
test("two distinct fifth-score modes, pending status, progress and CSV are offered",()=>{
 assert.match(page,/模式一｜個課表現 5 分/);
 assert.match(page,/模式二｜老師期末評分 5 分/);
 assert.match(page,/source==="privateLessonFrequency"/);
 assert.match(page,/source==="sectionFinal"/);
 assert.match(page,/return "期末 5 分待確認"/);
 assert.match(page,/if\(config\.mode!=="all"/);
 assert.match(page,/config\.scores\.set\(String\(student\.studentId\),record\)/);
 assert.match(page,/明細/);
 assert.match(page,/匯出目前篩選 CSV/);
 assert.match(page,/const csv=/);
 assert.match(page,/function csvSafe/);
 assert.doesNotMatch(page,/Math\.random\(/);
});

test("mobile view is compact by default and preserves full desktop score table",()=>{
 assert.match(page,/class="table-wrap"/);
 assert.match(page,/id="mobileStudents" class="mobile-student-list"/);
 assert.match(page,/@media\(max-width:760px\)/);
 assert.match(page,/\.table-wrap\{display:none\}/);
 assert.match(page,/\.mobile-student-list\{display:block\}/);
 assert.match(page,/\.mobile-student-details>summary/);
 assert.match(page,/查看 10＋5＋5 分數明細/);
 assert.match(page,/const expandedMobileStudents=new Set\(\)/);
 assert.match(page,/expandedMobileStudents\.has\(key\)/);
 assert.match(page,/expandedMobileStudents\.add\(key\)/);
 assert.match(page,/expandedMobileStudents\.delete\(key\)/);
 assert.match(page,/members\.map\(buildMobileCard\)/);
});
test("mobile totals do not misrepresent incomplete grades and are HTML-escaped",()=>{
 assert.match(page,/s\.total20!=null/);
 assert.match(page,/scoreLabel=.*"待完成"/);
 assert.match(page,/已取得 .*分（非總分）/);
 assert.match(page,/待完成："+missing\.join/);
 assert.match(page,/format\(s\.practice10,10\)/);
 assert.match(page,/format\(s\.attendance5,5\)/);
 assert.match(page,/format\(s\.performance5,5\)/);
 assert.match(page,/html\(student\.name\)/);
 assert.match(page,/html\(student\.section\|\|""\)/);
 assert.match(page,/env\(safe-area-inset-bottom,0px\)/);
 assert.match(page,/\.mobile-score-breakdown/);
});

test("embedded grade page JavaScript parses after mobile compact-card update",()=>{
 const source=page.split("<script>")[1]?.split("</script>")[0];
 assert.ok(source);
 assert.doesNotThrow(()=>new Script(source));
});
