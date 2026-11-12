(()=>{
  "use strict";

  function install(){
    if(window.__labLineStudentCoverage||typeof state==="undefined"||state.me?.role!=="admin")return false;
    if(typeof api!=="function"||typeof loadAdmin!=="function"||typeof studentsPage!=="function"||typeof render!=="function")return false;
    window.__labLineStudentCoverage=true;
    state.labLineStudentCoverage={loading:false,error:"",summary:null,items:[],filter:"all"};

    if(!document.getElementById("lab-line-student-coverage-style")){
      const style=document.createElement("style");
      style.id="lab-line-student-coverage-style";
      style.textContent=`
.lab-line-coverage{margin:14px 0;padding:16px;border:1px solid #cbd8d1;border-radius:14px;background:#f7fbf8;color:#17372d}
.lab-line-coverage-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.lab-line-coverage-title h3{margin:2px 0 0;font-size:20px}.lab-line-coverage-title small{color:#60766e}
.lab-line-coverage-title button{width:auto!important;margin:0!important;padding:8px 12px!important}
.lab-line-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:13px 0}
.lab-line-kpis>div{padding:11px;border:1px solid #d7e4dd;border-radius:11px;background:#fff}
.lab-line-kpis b{display:block;color:#215b47;font-size:22px}.lab-line-kpis span{display:block;margin-top:3px;color:#536b62;font-size:12px;line-height:1.45}
.lab-line-coverage p{margin:9px 0;color:#4c625a;font-size:13px;line-height:1.65}
.lab-line-coverage .lab-line-coverage-caution{padding:8px 10px;border-radius:8px;background:#fff6d9;color:#6f5310}
.lab-line-filters{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.lab-line-filters button{width:auto!important;margin:0!important;padding:7px 10px!important;border:1px solid #b9cbc2!important;border-radius:999px!important;background:#fff!important;color:#285745!important;font-size:12px!important}
.lab-line-filters button[aria-pressed="true"]{border-color:#28664f!important;background:#28664f!important;color:#fff!important}
.lab-line-visible-count{display:block;margin-top:9px;color:#60766e}
.lab-line-row-status{margin-top:5px!important;padding:3px 6px;border-radius:6px;font-size:11px!important;font-weight:700}
.lab-line-row-status.good{background:#dcf6e7;color:#17613b}.lab-line-row-status.warn{background:#fff1c9;color:#825b00}.lab-line-row-status.muted{background:#eef2f0;color:#52655e}
.lab-line-parent-detail{margin:12px 8px 4px;padding:12px;border:1px solid #d7e4dd;border-radius:12px;background:#f7fbf8}
.lab-line-parent-detail h3{margin:0 0 9px;color:#214f40;font-size:16px}
.lab-line-parent-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #e0e9e4}
.lab-line-parent-row:first-of-type{border-top:0}.lab-line-parent-row small{display:block;margin-top:3px;color:#60766e}
.lab-line-parent-row>span{flex:0 0 auto;padding:4px 7px;border-radius:7px;font-size:11px;font-weight:700}
.lab-line-parent-row>span.good{background:#dcf6e7;color:#17613b}.lab-line-parent-row>span.warn{background:#fff1c9;color:#825b00}.lab-line-parent-row>span.muted{background:#eef2f0;color:#52655e}
.lab-line-heading-summary{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;padding:10px 12px;border-left:4px solid #28664f;border-radius:8px;background:#edf7f2;color:#3c5c50;font-size:13px}
.lab-line-heading-summary b{color:#174f3a}
.lab-line-shortcut-count{display:block;margin-top:5px;color:#28664f;font-size:11px;font-style:normal;font-weight:700;line-height:1.45}
@media(max-width:700px){.lab-line-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.lab-line-parent-row{display:block}.lab-line-parent-row>span{display:inline-block;margin-top:7px}.lab-line-coverage{padding:13px}.lab-line-coverage-title{align-items:center}}
`;
      document.head.appendChild(style);
    }

    const itemMap=()=>new Map((state.labLineStudentCoverage?.items||[]).map(item=>[String(item.studentId||""),item]));
    const statusInfo=(item,inactive=false)=>{
      if(!item&&inactive)return {key:"inactive",label:"退出／停用（不列入統計）",tone:"muted"};
      if(!item)return {key:"missing",label:"LINE 狀態未載入",tone:"muted"};
      if(item.status==="NOTIFIABLE")return {key:"notifiable",label:`綁定時可通知 ${item.notifiableParentCount}/${item.parentCount} 位家長`,tone:"good"};
      if(item.status==="BOUND_UNKNOWN")return {key:"pending",label:`LINE 已綁定 ${item.lineBoundParentCount}/${item.parentCount}｜好友狀態待確認`,tone:"warn"};
      if(item.status==="BOUND_NOT_FRIEND")return {key:"not_friend",label:`LINE 已綁定 ${item.lineBoundParentCount}/${item.parentCount}｜尚不可通知`,tone:"warn"};
      if(item.status==="UNBOUND")return {key:"unbound",label:"LINE 尚未綁定",tone:"muted"};
      return {key:"no_parent",label:"尚無家長 Gmail",tone:"muted"};
    };
    const formatTime=value=>{
      if(!value)return "";
      const date=new Date(value);if(Number.isNaN(date.getTime()))return "";
      return date.toLocaleString("zh-TW",{timeZone:"Asia/Taipei",hour12:false});
    };

    async function loadCoverage(){
      if(state.me?.role!=="admin")return;
      const view=state.labLineStudentCoverage;
      view.loading=true;view.error="";
      try{
        const result=await api("/api/line/lab-student-coverage");
        view.summary=result.summary||null;view.items=Array.isArray(result.items)?result.items:[];
      }catch(error){
        view.summary=null;view.items=[];view.error=String(error?.message||"LINE 綁定統計載入失敗");
      }finally{view.loading=false}
    }

    const previousLoadAdmin=loadAdmin;
    loadAdmin=async function(){await previousLoadAdmin();await loadCoverage()};

    function coveragePanel(){
      const view=state.labLineStudentCoverage||{};
      if(view.loading&&!view.summary)return `<section class="lab-line-coverage"><h3>💬 LINE 通知綁定</h3><div class="notice">正在讀取 LAB LINE 綁定統計…</div></section>`;
      if(view.error)return `<section class="lab-line-coverage"><h3>💬 LINE 通知綁定</h3><div class="notice warn">${esc(view.error)}<br><button type="button" class="secondary" onclick="reloadLabLineStudentCoverage()">重新讀取</button></div></section>`;
      const summary=view.summary||{activeStudents:0,boundStudents:0,notifiableStudents:0,unboundStudents:0,uniqueParentAccounts:0,uniqueBoundParents:0};
      const filter=String(view.filter||"all");
      const buttons=[
        ["all","全部"],["notifiable","綁定時可通知"],["pending","好友狀態待確認"],["not_friend","尚不可通知"],["unbound","尚未綁定"],["no_parent","尚無家長 Gmail"]
      ].map(([key,label])=>`<button type="button" data-line-coverage-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join("");
      return `<section class="lab-line-coverage" aria-label="LAB LINE 綁定統計">
        <div class="lab-line-coverage-title"><div><small>LAB 專用資料</small><h3>💬 LINE 通知綁定</h3></div><button type="button" class="secondary" onclick="reloadLabLineStudentCoverage()">重新讀取</button></div>
        <div class="lab-line-kpis">
          <div><b>${Number(summary.activeStudents||0)}</b><span>在團學生</span></div>
          <div><b>${Number(summary.boundStudents||0)}</b><span>已有 LINE 綁定的學生</span></div>
          <div><b>${Number(summary.uniqueBoundParents||0)}</b><span>已綁定家長帳號</span></div>
          <div><b>${Number(summary.unboundStudents||0)}</b><span>尚未完成 LINE 綁定</span></div>
        </div>
        <p>以學生帳戶為查詢主軸；LINE 綁定仍屬於家長帳號。同一家長若有兩名子女，家長綁定數只計 1 次，兩名學生都會列入涵蓋學生。</p>
        <p class="lab-line-coverage-caution">「已綁定」不等於已讀；「可通知」僅表示綁定時確認為官方帳號好友。</p>
        <div class="lab-line-filters" role="group" aria-label="依 LINE 綁定狀態篩選">${buttons}</div>
        <small id="labLineCoverageVisibleCount" class="lab-line-visible-count"></small>
      </section>`;
    }

    const previousStudentsPage=studentsPage;
    studentsPage=function(){
      const html=previousStudentsPage(),marker='<div class="card student-master-list student-task-panel" data-student-task-panel="browse"><h2>查詢／修改學生</h2>';
      return html.includes(marker)?html.replace(marker,marker+coveragePanel()):html;
    };

    function parentRows(item){
      if(!item?.parents?.length)return `<div class="notice">此學生目前尚無已核准的家長 Gmail 關聯。</div>`;
      return item.parents.map(parent=>{
        const stateText=!parent.bound?"尚未綁定 LINE":parent.friendStatus==="friend"?"已綁定｜綁定時可通知":parent.friendStatus==="not_friend"?"已綁定｜未加入或已封鎖官方帳號":"已綁定｜好友狀態待確認";
        const lineName=parent.lineDisplayName?`<small>LINE：${esc(parent.lineDisplayName)}</small>`:"";
        const boundAt=parent.boundAt?`<small>綁定時間：${esc(formatTime(parent.boundAt))}</small>`:"";
        return `<div class="lab-line-parent-row"><div><b>${esc(parent.relationship||"家長")}${parent.parentName?`｜${esc(parent.parentName)}`:""}</b><small>${esc(parent.parentEmailMasked||"")}</small>${lineName}${boundAt}</div><span class="${parent.friendStatus==="friend"?"good":parent.bound?"warn":"muted"}">${stateText}</span></div>`;
      }).join("");
    }

    function mountRows(){
      if(state.me?.role!=="admin")return;
      const summary=state.labLineStudentCoverage?.summary;
      const shortcut=document.querySelector('.aw-shortcuts [data-workspace-action="students"] span:first-child');
      if(shortcut&&summary){
        let count=shortcut.querySelector(".lab-line-shortcut-count");
        if(!count){count=document.createElement("em");count.className="lab-line-shortcut-count";shortcut.appendChild(count)}
        count.textContent=`LAB｜LINE 綁定涵蓋 ${Number(summary.boundStudents||0)}/${Number(summary.activeStudents||0)} 位學生｜${Number(summary.uniqueBoundParents||0)} 位家長`;
      }
      if(state.page!=="students")return;
      const byId=itemMap(),filter=String(state.labLineStudentCoverage?.filter||"all");
      const heading=document.querySelector(".student-workspace-heading");
      if(heading&&summary){
        let strip=heading.querySelector(".lab-line-heading-summary");
        if(!strip){strip=document.createElement("div");strip.className="lab-line-heading-summary";heading.appendChild(strip)}
        strip.innerHTML=`<span>LINE 綁定涵蓋 <b>${Number(summary.boundStudents||0)} / ${Number(summary.activeStudents||0)}</b> 位學生</span><span>｜不重複家長 <b>${Number(summary.uniqueBoundParents||0)} / ${Number(summary.uniqueParentAccounts||0)}</b> 位</span>`;
      }
      let visible=0;
      for(const row of document.querySelectorAll(".student-master-row")){
        const studentId=String(row.querySelector("summary span:first-child small")?.textContent||"").trim();
        const item=byId.get(studentId),cell=row.querySelector("summary span:last-child");
        const inactive=!item&&String(cell?.textContent||"").includes("退出／停用"),info=statusInfo(item,inactive);
        const show=filter==="all"||info.key===filter;
        row.hidden=!show;if(show)visible++;
        if(cell){
          let badge=cell.querySelector(".lab-line-row-status");
          if(!badge){badge=document.createElement("small");badge.className="lab-line-row-status";cell.appendChild(badge)}
          badge.className=`lab-line-row-status ${info.tone}`;badge.textContent=info.label;
        }
        const edit=row.querySelector(".student-master-edit");
        if(edit){
          let detail=edit.querySelector(".lab-line-parent-detail");
          if(!detail){detail=document.createElement("section");detail.className="lab-line-parent-detail";edit.appendChild(detail)}
          detail.innerHTML=`<h3>💬 家長 LINE 通知狀態</h3>${inactive?'<div class="notice">此學生已退出／停用，不列入目前在團學生的 LINE 通知涵蓋統計。</div>':parentRows(item)}`;
        }
      }
      const count=document.getElementById("labLineCoverageVisibleCount");
      if(count)count.textContent=`目前畫面符合 LINE 條件：${visible} 位學生`;
    }

    window.reloadLabLineStudentCoverage=async function(){await loadCoverage();render()};
    document.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-line-coverage-filter]");if(!button)return;
      state.labLineStudentCoverage.filter=String(button.dataset.lineCoverageFilter||"all");
      document.querySelectorAll("[data-line-coverage-filter]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
      mountRows();
    });

    const previousRender=render;
    render=function(){const result=previousRender();setTimeout(mountRows,0);return result};
    loadCoverage().then(()=>render()).catch(()=>render());
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    try{
      if(window.__roleModulesReady===true&&install())clearInterval(timer);
      else if(tries>600)clearInterval(timer);
    }catch(error){if(tries>600){console.warn("LAB LINE coverage UI unavailable",error?.name||"Error");clearInterval(timer)}}
  },25);
})();
