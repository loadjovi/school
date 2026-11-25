import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../api/src/functions/googleLogin.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
function fixture(){
 const handlers={},verified=[];
 runInNewContext(source,{app:{http:(name,route)=>handlers[name]=route.handler},URLSearchParams,
  verifyGoogleToken:async token=>{verified.push(token);return token==='fresh-google-token'?{sub:'teacher-sub',email:'teacher@example.invalid'}:null}});
 return {verified,run:({state,extraState,token='fresh-google-token',formCsrf='browser-csrf',cookieCsrf='browser-csrf'}={})=>{
  const fields=new URLSearchParams({credential:token,g_csrf_token:formCsrf});if(state!==undefined)fields.set('state',state);if(extraState!==undefined)fields.append('state',extraState);
  return handlers.googleLogin({text:async()=>fields.toString(),headers:new Headers({cookie:'g_csrf_token='+cookieCsrf})});
 }};
}

test('redirect-mode Google sign-in preserves the fixed teacher or parent destination independently of browser storage',async()=>{
 for(const [state,key] of [['teacher-account:school-a','teacherLineAccount'],['parent-account:school-a','parentLineAccount']]){
  const h=fixture(),response=await h.run({state});assert.equal(response.status,302);const target=new URL(response.headers.Location,'https://school.example.invalid');
  assert.equal(target.origin,'https://school.example.invalid');assert.equal(target.pathname,'/');assert.equal(target.searchParams.get('google_redirect'),'1');assert.equal(target.searchParams.get(key),'school-a');assert.equal([...target.searchParams].length,2);
  assert.deepEqual(h.verified,['fresh-google-token']);assert.match(response.headers['Set-Cookie'],/orchestra_google_id_token=fresh-google-token/);assert.match(response.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
 }
});

test('arbitrary, duplicate or malformed button state cannot select another URL, role, credential or student',async()=>{
 for(const options of [{},{state:'https://evil.invalid'},{state:'teacher-account:../school-a'},{state:'teacher-account:school-a&studentId=foreign'},{state:'teacher-account:school-a#teacher'},{state:'teacher-account:school-a',extraState:'parent-account:school-b'},{state:'global:school-a'},{state:'teacher-account:'+('a'.repeat(61))}]){
  const h=fixture(),response=await h.run(options);assert.equal(response.status,302);assert.equal(response.headers.Location,'/?google_redirect=1');
 }
});

test('a return hint cannot bypass Google token or CSRF verification and never grants a teacher role',async()=>{
 for(const options of [{token:'expired-token'},{token:''},{formCsrf:''},{formCsrf:'wrong'},{cookieCsrf:''}]){
  const h=fixture(),response=await h.run({state:'teacher-account:school-a',...options});assert.ok([400,401].includes(response.status));assert.equal(response.headers.Location,undefined);assert.equal(response.headers['Set-Cookie'],undefined);
 }
});
