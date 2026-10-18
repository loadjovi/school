import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/school-admin-workspace.js', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../app/desktop-ui.js', import.meta.url), 'utf8');
const report = readFileSync(new URL('../app/practice-progress.js', import.meta.url), 'utf8');

test('school homepage has a direct monthly practice report shortcut', () => {
  assert.match(workspace, /\['practiceProgress','自主練習月報','查看每月練習天數、時間與學生紀錄'\]/);
  assert.doesNotMatch(workspace, /\['learning','學習與成績'/);
});

test('old intermediate assessment-only screens are not in the school workspace', () => {
  assert.doesNotMatch(workspace, /data-workspace-group="assessment"/);
  assert.doesNotMatch(workspace, /class="aw-assessment"/);
  assert.doesNotMatch(workspace, /class="aw-learning/);
});

test('desktop menu opens the same report, without a learning submenu', () => {
  assert.match(desktop, /item\("practiceProgress","📚","自主練習月報","practiceProgress"\)/);
  assert.doesNotMatch(desktop, /workspace:learning/);
});

test('report route still loads the established practice report implementation', () => {
  assert.match(report, /if\(p==='practiceProgress'&&canView\(\)\)/);
  assert.match(report, /await loadPracticeProgress\(\)/);
});
