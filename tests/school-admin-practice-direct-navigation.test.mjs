import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/school-admin-workspace.js', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../app/desktop-ui.js', import.meta.url), 'utf8');
const report = readFileSync(new URL('../app/practice-progress.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/school-admin-workspace.css', import.meta.url), 'utf8');
const index = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../app/webview-guard.js', import.meta.url), 'utf8');

test('school homepage combines semester grades and monthly practice in one shortcut', () => {
  assert.match(workspace, /\['grades','成績與練習','學期 20 分總覽、每月自主練習明細與 CSV'\]/);
  assert.doesNotMatch(workspace, /\['practiceProgress','自主練習月報'/);
});

test('unified learning workspace clearly separates semester overview from monthly detail', () => {
  assert.match(workspace, /class="aw-learning-workspace"/);
  assert.match(workspace, /data-learning-work="overview"/);
  assert.match(workspace, /data-learning-work="practice"/);
  assert.match(workspace, /學期總覽用來掌握 20 分完成度/);
  assert.match(workspace, /月報用來追蹤自主練習天數、分鐘與逐日內容/);
  assert.match(workspace, /adminPracticeProgressHtml/);
});

test('desktop menu has one learning entry instead of two competing destinations', () => {
  assert.match(desktop, /item\("adminLearning","📊","成績與練習","workspace:grades"\)/);
  assert.doesNotMatch(desktop, /item\("practiceProgress","📚","自主練習月報"/);
});

test('legacy admin monthly-report route opens the integrated practice tab', () => {
  assert.match(report, /p==='practiceProgress'&&isAdmin\(\)[\s\S]*openAdminLearningWorkspace\('practice'\)/);
  assert.match(report, /window\.adminPracticeProgressHtml/);
  assert.match(report, /window\.loadAdminPracticeProgress/);
  assert.match(report, /學期完整 20 分請切換上方「學期成績總覽」/);
});

test('learning workspace is mobile friendly and its assets are cache-busted', () => {
  assert.match(css, /\.aw-learning-tabs\{display:grid/);
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?\.aw-learning-tabs\{grid-template-columns:1fr/);
  assert.match(index, /school-admin-workspace\.css\?v=20261102-learning-workspace/);
  assert.match(index, /styles\.css\?v=20261104-practice-filter-anchor/);
  assert.match(index, /webview-guard\.js\?v=20261107-line-settings-group/);
  assert.match(guard, /practice-progress\.js\?v=20261104-practice-filter-anchor/);
  assert.match(guard, /desktop-ui\.js\?v=20261102-learning-workspace/);
  assert.match(guard, /school-admin-workspace\.js\?v=20261107-line-settings-group/);
});
