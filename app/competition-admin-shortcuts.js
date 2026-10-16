// A 團比賽服後台：沿用團 T 的功能入口，一次只顯示一個工作區。
const competitionViews=new Set(["students","requests","procurement","inventory","returns"]);
let selectedCompetitionView="students";
function syncCompetitionViews(){
 const active=document.querySelector('[data-admin-tab="competitionUniform"]')?.getAttribute("aria-selected")==="true";
 const shortcuts=document.getElementById("competitionShortcutPanel");
 if(!active||shortcuts?.hidden)return;
 for(const button of shortcuts.querySelectorAll("[data-competition-view]"))button.setAttribute("aria-pressed",String(button.dataset.competitionView===selectedCompetitionView));
 for(const panel of document.querySelectorAll('[data-admin-view="competitionUniform"][data-competition-panel]'))panel.hidden=panel.dataset.competitionPanel!==selectedCompetitionView;
}
document.querySelectorAll("[data-competition-view]").forEach(button=>button.addEventListener("click",()=>{
 if(!competitionViews.has(button.dataset.competitionView))return;
 selectedCompetitionView=button.dataset.competitionView;
 syncCompetitionViews();
 document.querySelector('[data-admin-view="competitionUniform"][data-competition-panel="'+selectedCompetitionView+'"]')?.scrollIntoView({behavior:"smooth",block:"start"});
}));
window.syncCompetitionViews=syncCompetitionViews;
queueMicrotask(syncCompetitionViews);
