// Load only the tools belonging to this workspace; financial tools wait for auth.
const finance=window.uniformFinanceWorkspace?.isFinance===true;
window.uniformAdminModulesReady=Promise.all([...document.querySelectorAll('script[type="application/x-uniform-module"][src]')].filter(script=>(script.dataset.scope==='finance')===finance).map(script=>import(script.src)));
