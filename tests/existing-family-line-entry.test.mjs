import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../app/app-v3.js',import.meta.url),'utf8');
const panel=app.slice(app.indexOf('function lineAccountRecoveryPanel(){'),app.indexOf('function home(){'));
function render(schoolId){
 return runInNewContext(panel+'\nlineAccountRecoveryPanel()',{
   state:{me:{schoolId,role:'unassigned',authProvider:'line'}},URLSearchParams,
   esc:value=>String(value).replaceAll('&','&amp;'),
   fetch:()=>{throw Error('Showing choices must not create a registration or send LINE');}
 });
}
test('an unassigned LINE user sees distinct existing Gmail household, teacher, and first-time applicant paths',()=>{
 const html=render('sacred-heart');
 const urls=[...html.matchAll(/href="([^"]+)"/g)].map(([,href])=>new URL(href.replaceAll('&amp;','&'),'https://example.invalid'));
 assert.deepEqual(urls.map(url=>[url.pathname,[...url.searchParams.keys()],url.searchParams.get('parentLineAccount')||url.searchParams.get('teacherLineAccount'),url.searchParams.get('openExternalBrowser')]),[
  ['/', ['parentLineAccount','openExternalBrowser'], 'sacred-heart','1'],
  ['/', ['teacherLineAccount','openExternalBrowser'], 'sacred-heart','1']
 ]);
 assert.match(html,/已核准家長｜用原 Gmail 綁定 LINE/);
 assert.match(html,/已建檔老師｜用原 Gmail 綁定 LINE/);
 assert.match(html,/go\('register'\)">首次申請家長資格/);
 assert.doesNotMatch(html,/id="rStudentNo"|送出綁定申請/);
});
test('account recovery never makes a Gmail binding URL for an invalid or missing school',()=>{
 for(const school of ['', 'invalid/school', 'x'])assert.doesNotMatch(render(school),/href=|LineAccount=/);
});
