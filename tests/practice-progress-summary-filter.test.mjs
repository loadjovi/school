import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const report=readFileSync(new URL('../app/practice-progress.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/styles.css',import.meta.url),'utf8');

function harness(){
  let renderCalls=0,scrollCalls=0;
  const state={
    me:{role:'admin',capabilities:{}},
    practiceProgressMonth:'2026-11',practiceProgressStatus:'全部',practiceProgressSelected:'',
    practiceProgressData:{month:'2026-11',taipeiToday:'2026-11-04',qualifiedMinutes:20,effectiveTargetDays:4,items:[
      {studentId:'s0',name:'尚未練習',groupName:'A',section:'小提一部',instrument:'小提琴',grade:'四年級',activeDays:0,qualifiedDays:0,totalMinutes:0,records:[]},
      {studentId:'s1',name:'已有達標',groupName:'A',section:'小提二部',instrument:'小提琴',grade:'五年級',activeDays:1,qualifiedDays:1,totalMinutes:40,lastPracticeDate:'2026-11-01',records:[{practiceDate:'2026-11-01',minutes:40,qualified:true}]},
      {studentId:'s2',name:'尚未達標',groupName:'B',section:'大提',instrument:'大提琴',grade:'三年級',activeDays:1,qualifiedDays:0,totalMinutes:10,lastPracticeDate:'2026-11-02',records:[{practiceDate:'2026-11-02',minutes:10,qualified:false}]}
    ]}
  };
  const attrs={};
  const panel={hidden:true,innerHTML:''};
  const trigger={innerHTML:'',setAttribute:(key,value)=>{attrs[key]=value},focus:()=>{}};
  const card={
    dataset:{practiceStudentId:'s1'},classList:{toggle:()=>{}},
    querySelector:selector=>selector==='[data-practice-detail-toggle]'?trigger:selector==='[data-practice-detail]'?panel:null,
    getBoundingClientRect:()=>({top:120})
  };
  const button={closest:()=>card};
  const document={
    querySelectorAll:selector=>selector==='[data-practice-student-id]'?[card]:[],
    querySelector:()=>null,getElementById:()=>null
  };
  const window={};
  const context=vm.createContext({state,window,document,console,Intl,Date,Math,Number,String,Map,Set,Promise,
    esc:value=>String(value??''),api:async()=>({items:[]}),toast:()=>{},shell:value=>value,
    go:()=>{},render:()=>{renderCalls++},requestAnimationFrame:callback=>callback(),
    scrollBy:()=>{scrollCalls++},CSS:{escape:value=>String(value)}
  });
  vm.runInContext(report,context);
  return {context,state,window,button,panel,trigger,attrs,get renderCalls(){return renderCalls},get scrollCalls(){return scrollCalls}};
}

test('summary cards are the filters and the duplicate filter bank is gone',()=>{
  const h=harness(),html=h.window.adminPracticeProgressHtml();
  assert.equal((html.match(/data-practice-status=/g)||[]).length,5);
  assert.match(html,/點選統計卡，即可篩選下方學生列表/);
  assert.match(html,/全部授課學生/);
  assert.match(html,/本月有紀錄（人）/);
  assert.match(html,/至少 1 天達 20 分鐘（人）/);
  assert.match(html,/本月尚無紀錄（人）/);
  assert.match(html,/單筆未滿 20 分鐘/);
  assert.doesNotMatch(report,/const filterBtn=/);
  assert.match(css,/\.practice-summary-filter\.is-active/);
});

test('recorded-student summary card filters without changing the other status rules',()=>{
  assert.match(report,/status==="本月有紀錄"&&active===0/);
  const h=harness();
  h.state.practiceProgressStatus='本月有紀錄';
  const html=h.window.adminPracticeProgressHtml();
  assert.match(html,/學生列表 <span[^>]*>2 人/);
  assert.doesNotMatch(html,/尚未練習 <span/);
});

test('student detail opens in place without rerendering the whole report',()=>{
  const h=harness();
  h.window.togglePracticeProgressDetail('s1',h.button);
  assert.equal(h.state.practiceProgressSelected,'s1');
  assert.equal(h.renderCalls,0);
  assert.equal(h.panel.hidden,false);
  assert.match(h.panel.innerHTML,/2026-11 完整紀錄/);
  assert.equal(h.attrs['aria-expanded'],'true');
  assert.match(h.trigger.innerHTML,/收合明細/);
  h.window.togglePracticeProgressDetail('s1',h.button);
  assert.equal(h.state.practiceProgressSelected,'');
  assert.equal(h.renderCalls,0);
  assert.equal(h.panel.hidden,true);
  assert.equal(h.panel.innerHTML,'');
  assert.equal(h.attrs['aria-expanded'],'false');
});
