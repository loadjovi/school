let academicYearPreview=null;
function mostCommonSchoolYear(){
  const c={};for(const s of (state.master||[])){if(s.status!=="active")continue;const y=String(s.schoolYear||"").trim();if(y)c[y]=(c[y]||0)+1}
  return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
}
function nextSchoolYearValue(y){const n=Number(String(y||"").trim());return Number.isFinite(n)&&n>0?String(n+1):""}
function batchUpgradeCard(){
  const from=mostCommonSchoolYear(),to=nextSchoolYearValue(from);
  return `<div class="card hero"><h2>📚 學年度批次升級</h2><div class="notice">建議每學年執行一次。系統只自動更新「學年度＋年級」；<b>團別不自動升降</b>，A／B／儲備團仍依考核結果個別調整。六年級預設標記為停用／畢業。正式執行前一定會先預覽。</div>
  <div class="row2"><div><label>來源學年度</label><input id="ayFrom" value="${esc(from)}" placeholder="例：115"></div><div><label>目標學年度</label><input id="ayTo" value="${esc(to)}" placeholder="例：116"></div></div>
  <div class="check"><input id="ayPromote" type="checkbox" checked><div>一年級→二年級、二→三、三→四、四→五、五→六</div></div>
  <div class="check"><input id="ayGraduate" type="checkbox" checked><div>六年級於批次後標記為停用／畢業</div></div>
  <div class="check"><input id="ayBlank" type="checkbox"><div>來源學年度空白的在團學生也一起納入（舊資料整理時使用）</div></div>
  <button class="primary" onclick="previewAcademicYearUpgrade()">先預覽批次結果</button><div id="ayPreview" style="margin-top:12px"></div></div>`;
}
function batchParams(action="preview"){
  return {action,fromSchoolYear:$("ayFrom")?.value||"",toSchoolYear:$("ayTo")?.value||"",promoteGrades:$("ayPromote")?.checked!==false,graduateSixth:$("ayGraduate")?.checked!==false,includeBlankYear:$("ayBlank")?.checked===true};
}
async function previewAcademicYearUpgrade(){
  try{
    const data=await api("/api/academic-year-promotion",{method:"POST",body:JSON.stringify(batchParams("preview"))});
    academicYearPreview=data;renderAcademicYearPreview(data);
  }catch(e){toast("❌ "+e.message)}
}
function renderAcademicYearPreview(data){
  const box=$("ayPreview");if(!box)return;
  const s=data.summary||{},items=data.items||[];
  box.innerHTML=`<div class="notice"><b>預覽結果</b><br>預計異動 ${s.affected||0} 人｜升級 ${s.promoted||0} 人｜六年級畢業 ${s.graduated||0} 人｜僅改學年度 ${s.yearOnly||0} 人｜略過 ${s.skipped||0} 人</div>${items.length?`<div style="margin-top:10px">${items.map(x=>`<div class="item"><div style="display:flex;gap:9px;align-items:flex-start"><input class="ayPick" type="checkbox" value="${esc(x.studentId)}" checked style="width:18px;height:18px;margin-top:2px"><div><b>${esc(x.name)}</b><small>${esc(x.groupName)}團｜${esc(x.instrument||"未填樂器")}<br>${esc(x.oldSchoolYear||"未填學年度")}／${esc(x.oldGrade)} → ${esc(x.newSchoolYear)}／${x.newStatus==="inactive"?"畢業／停用":esc(x.newGrade)}</small></div></div></div>`).join("")}</div><button class="primary" onclick="applyAcademicYearUpgrade()">確認執行勾選的 ${items.length} 位</button>`:`<div class="notice" style="margin-top:10px">沒有符合條件的學生。</div>`}`;
}
async function applyAcademicYearUpgrade(){
  if(!academicYearPreview){toast("請先執行預覽");return}
  const ids=[...document.querySelectorAll(".ayPick:checked")].map(x=>x.value);
  if(!ids.length){toast("請至少勾選 1 位學生");return}
  const to=$("ayTo")?.value||"";
  if(!confirm(`確定將 ${ids.length} 位學生批次升級到 ${to} 學年度？\n\n團別不會自動異動，所有變更都會寫入 StudentHistory。`))return;
  try{
    const body={...batchParams("apply"),studentIds:ids,confirmApply:true};
    const data=await api("/api/academic-year-promotion",{method:"POST",body:JSON.stringify(body)});
    toast(`✅ 已完成 ${data.summary?.affected||ids.length} 位學生升級`);
    academicYearPreview=null;await loadAdmin();render();
  }catch(e){toast("❌ "+e.message)}
}
const originalStudentsPage=studentsPage;
studentsPage=function(){return batchUpgradeCard()+originalStudentsPage()};
