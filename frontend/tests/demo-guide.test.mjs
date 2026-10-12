// FN-08 / #63: 審査デモガイドの進み具合の判定
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function load(relative) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} };
  new Function('module', 'exports', 'require', code)(compiled, compiled.exports, require);
  return compiled.exports;
}
const { demoGuideProgress } = load('../lib/demo-guide.ts');

const detail = (residentState, tasks = [], board = []) => ({
  issue: { issue_id: 'iss', emergency_id: 'em', status: 'TRIAGING' },
  tasks,
  current_states_summary: {},
  resident_states: residentState ? { 'resident-i': residentState } : {},
  priority_targets: [],
  task_board: board,
});
const task = (task_id, status, created_at) =>
  ({ task_id, issue_id: 'iss', resident_id: 'resident-i', status, created_at, task_type: 'NEIGHBOR_CHECK', title: '', description: '' });
const run = (emergencyId, issueDetail, triageCompleted = false, sawAdminView = false) =>
  demoGuideProgress({ emergencyId, issueDetail, triageCompleted, sawAdminView });

test('starts at step 1 before the emergency is triggered', () => {
  assert.equal(run(null, null).current, 0);
});

test('waits for resident 301 to answer SAFE, not NEED_HELP', () => {
  assert.equal(run('em', detail(undefined)).current, 1);
  assert.equal(run('em', detail('NEED_HELP')).current, 1);
  assert.equal(run('em', detail('SAFE')).current, 2);
});

test('uses the latest task of resident 301 and its target room', () => {
  const tasks = [task('t-old', 'DECLINED', '2026-10-13T00:00:00Z'), task('t-new', 'OFFERED', '2026-10-13T00:01:00Z')];
  const board = [{ task_id: 't-new', target_room_number: '303' }];
  const p = run('em', detail('SAFE', tasks, board), true);
  assert.equal(p.current, 3);
  assert.equal(p.myTask.task_id, 't-new');
  assert.equal(p.targetRoom, '303');
});

test('finishes only after the report and the admin view', () => {
  const tasks = [task('t1', 'COMPLETED', '2026-10-13T00:00:00Z')];
  assert.equal(run('em', detail('SAFE', tasks), true).current, 4);
  assert.equal(run('em', detail('SAFE', tasks), true, true).current, -1);
});

test('later steps never count as done before earlier ones', () => {
  // 別の審査員の操作でタスクだけ存在しても、住民301が未回答ならステップ2に留まる
  const p = run('em', detail(undefined, [task('t1', 'COMPLETED', 'x')]), true, true);
  assert.equal(p.current, 1);
  assert.deepEqual(p.done, [true, false, false, false, false]);
});
