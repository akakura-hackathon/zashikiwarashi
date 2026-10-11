// FN-02 / FN-08: Render real components and exercise asynchronous user actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { create, act } from 'react-test-renderer';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setInterval, clearInterval };
let alerts = [];
globalThis.alert = (message) => alerts.push(message);
const cache = new Map();
const mocks = new Map();
function load(filename) {
  const full = path.resolve(root, filename);
  if (cache.has(full)) return cache.get(full);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const compiled = { exports: {} };
  const resolve = (specifier) => {
    if (mocks.has(specifier)) return mocks.get(specifier);
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
    const target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(full), specifier);
    return load(fs.existsSync(target + '.tsx') ? target + '.tsx' : target + '.ts');
  };
  new Function('module', 'exports', 'require', code)(compiled, compiled.exports, resolve);
  cache.set(full, compiled.exports);
  return compiled.exports;
}
const realApi = load('lib/api-client.ts');
const api = {
  ...realApi,
  getActiveEmergency: async () => ({ is_active: false }),
  getTaskDetail: async () => null,
  getMyAuditEvents: async () => ({ audit_events: [] }),
};
mocks.set('@/lib/api-client', api);
mocks.set('@/lib/push-notification', {});
const user = { uid: 'login-user', email: 'demo@example.com', isAnonymous: false, getIdToken: async () => 'mock-token' };
mocks.set('firebase/auth', {
  getAuth: () => ({}), onAuthStateChanged: (_, callback) => { callback(user); return () => {}; },
});
mocks.set('@/lib/firebase', { getFirebaseApp: () => ({}) });
const { PhoneStage } = load('components/PhoneStage.tsx');
const { StudioWorkspace } = load('components/StudioWorkspace.tsx');
const { applySafetyConfirmation } = load('lib/emergency-view.ts');
const initial = () => ({
  issue: { issue_id: 'issue-1', emergency_id: 'em-1', created_at: new Date().toISOString() },
  tasks: [], priority_targets: [],
  resident_states: { 'resident-i': 'SAFE', 'resident-h': 'UNKNOWN', 'resident-j': 'NEED_HELP', 'resident-k': 'UNKNOWN' },
  room_states: { '301': 'SAFE', '302': 'UNKNOWN', '303': 'NEED_HELP', '504': 'UNKNOWN' },
  current_states_summary: { SAFE: 1, NEED_HELP: 1, UNKNOWN: 48 },
});
const contents = (node) => typeof node === 'string' ? node : (node.children ?? []).map(contents).join('');
const button = (renderer, text) => renderer.root.findAllByType('button').find((node) => contents(node).includes(text));
const text = (renderer) => contents(renderer.toJSON());
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function answer(req, persona) { return { ...req, resident_id: persona.userId, observed_at: new Date().toISOString() }; }

test('SAFE → NEED_HELP → SAFE and repeated NEED_HELP show only one screen', async () => {
  let renderer;
  let saved;
  api.confirmPresence = async (_, req, persona) => answer(req, persona);
  function Harness() {
    const [detail, setDetail] = React.useState(initial);
    saved = detail;
    return React.createElement(PhoneStage, {
      activePersona: api.DEMO_PERSONAS[1], emergencyId: 'em-1', tasks: [], issueDetail: detail, user,
      onActionComplete: async (_, response) => setDetail((value) => applySafetyConfirmation(value, response, '301')),
    });
  }
  try {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { button(renderer, '回答を「被害あり」に変更する').props.onClick(); });
    assert.match(text(renderer), /被害の内容を教えてください/);
    assert.doesNotMatch(text(renderer), /無事を受け付けました/);
    await act(async () => { await button(renderer, '管理人に送る').props.onClick(); });
    assert.equal(saved.resident_states['resident-i'], 'NEED_HELP');
    for (let i = 0; i < 2; i++) {
      await act(async () => { button(renderer, '状況が変わったので更新する').props.onClick(); });
      assert.doesNotMatch(text(renderer), /管理人に伝わりました/);
      await act(async () => { button(renderer, '被害あり（').props.onClick(); });
      await act(async () => { await button(renderer, '管理人に送る').props.onClick(); });
    }
    assert.equal(saved.current_states_summary.NEED_HELP, 2);
    await act(async () => { button(renderer, '状況が変わったので更新する').props.onClick(); });
    await act(async () => { await button(renderer, '無事（').props.onClick(); });
    assert.equal(saved.resident_states['resident-i'], 'SAFE');
    assert.match(text(renderer), /無事を受け付けました/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('failed resend retains edit form and double-click sends only once', async () => {
  let renderer;
  alerts = [];
  api.confirmPresence = async () => { throw new Error('offline'); };
  try {
    await act(async () => { renderer = create(React.createElement(PhoneStage, {
      activePersona: api.DEMO_PERSONAS[1], emergencyId: 'em-1', tasks: [], issueDetail: initial(), user,
      onActionComplete: async () => {},
    })); });
    await act(async () => { button(renderer, '回答を「被害あり」に変更する').props.onClick(); });
    await act(async () => { await button(renderer, '管理人に送る').props.onClick(); });
    assert.equal(alerts.length, 1);
    assert.match(text(renderer), /被害の内容を教えてください/);
    const pending = deferred();
    let calls = 0;
    api.confirmPresence = async (_, req, persona) => { calls++; await pending.promise; return answer(req, persona); };
    const submit = button(renderer, '管理人に送る').props.onClick;
    let request;
    await act(async () => { request = submit(); void submit(); });
    assert.equal(calls, 1);
    assert.equal(button(renderer, '送信中').props.disabled, true);
    await act(async () => { pending.resolve(); await request; });
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('Studio switching during a pending answer preserves the selected resident and handles failed refresh', async () => {
  let renderer;
  let state = initial();
  let failRefresh = false;
  const originalError = console.error;
  api.getIssueDetail = async () => { if (failRefresh) throw new Error('refresh offline'); return structuredClone(state); };
  api.triggerEmergency = async () => ({ emergency_id: 'em-1', issue_id: 'issue-1' });
  const pending = deferred();
  api.confirmPresence = async (_, req, persona) => { await pending.promise; const response = answer(req, persona); state = applySafetyConfirmation(state, response, persona.roomNumber); return response; };
  try {
    await act(async () => { renderer = create(React.createElement(StudioWorkspace)); });
    const cockpit = () => renderer.root.findByType(load('components/CockpitPanel.tsx').CockpitPanel);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    await act(async () => { button(renderer, '回答を「被害あり」に変更する').props.onClick(); });
    let request;
    await act(async () => { request = button(renderer, '管理人に送る').props.onClick(); });
    await act(async () => { cockpit().props.onSelectPersona(api.DEMO_PERSONAS[2]); });
    assert.equal(renderer.root.findByType(PhoneStage).props.activePersona.userId, 'resident-h');
    assert.match(text(renderer), /ご自身とお部屋は無事ですか/);
    assert.doesNotMatch(text(renderer), /被害の内容を教えてください/);
    failRefresh = true;
    console.error = () => {};
    await act(async () => { pending.resolve(); await request; });
    assert.match(text(renderer), /ご自身とお部屋は無事ですか/);
    await act(async () => { cockpit().props.onSelectPersona(api.DEMO_PERSONAS[1]); });
    assert.match(text(renderer), /管理人に伝わりました/);
    await act(async () => { cockpit().props.onSelectPersona(api.DEMO_PERSONAS[0]); });
    assert.doesNotMatch(text(renderer), /ご自身とお部屋は無事ですか/);
    assert.match(text(renderer), /発令・トリアージ・住戸別の状況確認/);
  } finally {
    console.error = originalError;
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('a slow poll completes and updates the selected persona instead of being superseded forever', async (t) => {
  let renderer;
  const pending = deferred();
  let reads = 0;
  api.getIssueDetail = async () => { reads++; return pending.promise; };
  api.triggerEmergency = async () => ({ emergency_id: 'em-1', issue_id: 'issue-1' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await act(async () => { renderer = create(React.createElement(StudioWorkspace)); });
    const cockpit = () => renderer.root.findByType(load('components/CockpitPanel.tsx').CockpitPanel);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    await act(async () => { t.mock.timers.tick(16000); });
    assert.equal(reads, 1);
    await act(async () => { pending.resolve(initial()); });
    assert.match(text(renderer), /無事を受け付けました/);
    await act(async () => { cockpit().props.onSelectPersona(api.DEMO_PERSONAS[3]); });
    assert.match(text(renderer), /管理人に伝わりました/);
    await act(async () => { t.mock.timers.tick(5000); });
    assert.equal(reads, 2);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    t.mock.timers.reset();
  }
});

test('an old answer arriving after a new emergency does not restore the old screen', async () => {
  let renderer;
  let generation = 0;
  const pending = deferred();
  api.triggerEmergency = async () => {
    generation++;
    return { emergency_id: `em-${generation}`, issue_id: `issue-${generation}` };
  };
  api.getIssueDetail = async (_, issueId) => {
    const result = initial();
    result.issue.issue_id = issueId;
    result.issue.emergency_id = issueId.replace('issue-', 'em-');
    if (issueId === 'issue-2') result.resident_states['resident-i'] = 'UNKNOWN';
    return result;
  };
  api.confirmPresence = async (_, req, persona) => { await pending.promise; return answer(req, persona); };
  try {
    await act(async () => { renderer = create(React.createElement(StudioWorkspace)); });
    const cockpit = () => renderer.root.findByType(load('components/CockpitPanel.tsx').CockpitPanel);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    await act(async () => { button(renderer, '回答を「被害あり」に変更する').props.onClick(); });
    let request;
    await act(async () => { request = button(renderer, '管理人に送る').props.onClick(); });
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    await act(async () => { pending.resolve(); await request; });
    assert.equal(cockpit().props.issueDetail.issue.emergency_id, 'em-2');
    assert.match(text(renderer), /ご自身とお部屋は無事ですか/);
    assert.doesNotMatch(text(renderer), /管理人に伝わりました/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('FN-08 damage receipt does not promise help before triage and an accepted incoming check', async () => {
  let renderer;
  const detail = initial();
  detail.resident_states['resident-i'] = 'NEED_HELP';
  const task = {
    task_id: 'check-1', issue_id: 'issue-1', resident_id: 'resident-h',
    target_resident_id: 'resident-i', task_type: 'NEIGHBOR_CHECK', status: 'APPROVED',
  };
  const render = async (issueStatus, tasks = [], emergencyId = 'em-1') => {
    const snapshot = { ...detail, issue: { ...detail.issue, status: issueStatus }, tasks };
    const element = React.createElement(PhoneStage, {
      activePersona: api.DEMO_PERSONAS[1], emergencyId, tasks, issueDetail: snapshot, user,
      onActionComplete: async () => {},
    });
    await act(async () => { if (renderer) renderer.update(element); else renderer = create(element); });
    assert.match(text(renderer), /対応を待たずに119番/);
    assert.ok(button(renderer, '状況が変わったので更新する'));
    assert.doesNotMatch(text(renderer), /救助隊が到着|優先支援リストに登録|救護の手配を進めています/);
  };
  const assertNoFlow = () => assert.doesNotMatch(text(renderer), /近隣の方による確認まで|安否確認への協力を承認しました|安否確認を実施中/);
  try {
    await render('OPEN', [task]);
    assertNoFlow();
    assert.match(text(renderer), /管理人による確認をお待ちください/);
    await render('TRIAGING');
    assertNoFlow();
    assert.match(text(renderer), /あなたへの対応はまだ確定していません/);
    for (const status of ['PENDING', 'OFFERED', 'DECLINED', 'FAILED', 'EXPIRED', 'COMPLETED']) {
      await render('TRIAGING', [{ ...task, status }]);
      assertNoFlow();
    }
    for (const overrides of [
      { target_resident_id: 'resident-j' },
      { issue_id: 'old-issue' },
      { task_type: 'OTHER' },
    ]) {
      await render('TRIAGING', [{ ...task, ...overrides }]);
      assertNoFlow();
    }
    await render('TRIAGING', [task], 'new-emergency');
    assertNoFlow();
    await render('TRIAGING', [task]);
    assert.match(text(renderer), /近隣の方による確認まで/);
    assert.match(text(renderer), /安否確認の開始を待っています/);
    await render('TRIAGING', [{ ...task, status: 'IN_PROGRESS' }]);
    assert.match(text(renderer), /安否確認を実施中です/);
    await render('TRIAGING', [{ ...task, status: 'FAILED' }]);
    assertNoFlow();
    await render('RESOLVED', [task]);
    assertNoFlow();
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('FN-01 administrator and resident share the answer guide countdown', async (t) => {
  let renderer;
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: Date.parse('2026-10-10T00:00:00Z') });
  let generation = 0;
  let snapshot;
  api.triggerEmergency = async () => {
    generation++;
    snapshot = initial();
    snapshot.issue = { ...snapshot.issue, emergency_id: `em-${generation}`, issue_id: `issue-${generation}` };
    snapshot.resident_states['resident-i'] = 'UNKNOWN';
    return { emergency_id: snapshot.issue.emergency_id, issue_id: snapshot.issue.issue_id };
  };
  api.getIssueDetail = async () => snapshot;
  const { CountdownPill } = load('components/ui/StatusAndInput.tsx');
  try {
    await act(async () => { renderer = create(React.createElement(StudioWorkspace)); });
    const cockpit = () => renderer.root.findByType(load('components/CockpitPanel.tsx').CockpitPanel);
    const countdowns = () => renderer.root.findAllByType(CountdownPill)
      .filter((node) => node.props.label === '回答の目安 残り')
      .map((node) => node.props.timeRemaining);
    assert.deepEqual(countdowns(), []);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    assert.deepEqual(countdowns(), ['2:00', '2:00']);
    await act(async () => { t.mock.timers.tick(18000); });
    assert.deepEqual(countdowns(), ['1:42', '1:42']);
    await act(async () => { cockpit().props.onSelectPersona(api.DEMO_PERSONAS[2]); });
    assert.deepEqual(countdowns(), ['1:42', '1:42']);
    await act(async () => { t.mock.timers.tick(200000); });
    assert.deepEqual(countdowns(), ['0:00', '0:00']);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    assert.deepEqual(countdowns(), ['2:00', '2:00']);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    t.mock.timers.reset();
  }
});

test('FN-07 completed confirmation shows only the current assignee’s authorized room', async () => {
  let renderer;
  const task = { task_id: 'done-1', issue_id: 'issue-1', resident_id: 'resident-i', target_resident_id: 'resident-h', task_type: 'NEIGHBOR_CHECK', status: 'COMPLETED' };
  let response = { task, is_disclosed: true, target_room_number: '302', target_floor: 3 };
  api.getTaskDetail = async () => response;
  const render = async (selectedTask, persona = api.DEMO_PERSONAS[1]) => {
    const detail = initial();
    detail.resident_states[persona.userId] = 'SAFE';
    detail.tasks = [selectedTask];
    const element = React.createElement(PhoneStage, {
      activePersona: persona, emergencyId: 'em-1', tasks: detail.tasks, issueDetail: detail, user,
      onActionComplete: async () => {},
    });
    await act(async () => { if (renderer) renderer.update(element); else renderer = create(element); });
  };
  try {
    await render(task);
    assert.match(text(renderer), /確認先住戸302号室/);
    assert.doesNotMatch(text(renderer), /開示終了|マスキングされました|現在非表示|8:05〜8:07/);
    response = { task, is_disclosed: false, target_room_number: null };
    await render({ ...task });
    assert.match(text(renderer), /確認先住戸•••号室/);
    response = { task: { ...task, task_id: 'old-task' }, is_disclosed: true, target_room_number: '302' };
    await render({ ...task });
    assert.doesNotMatch(text(renderer), /確認先住戸302号室/);
    response = { task, is_disclosed: true, target_room_number: '302' };
    await render({ ...task, resident_id: 'resident-j' }, api.DEMO_PERSONAS[3]);
    assert.doesNotMatch(text(renderer), /確認先住戸302号室/);
    response = { task, is_disclosed: true, target_room_number: '302' };
    await render({ ...task, status: 'OFFERED' });
    assert.doesNotMatch(text(renderer), /302号室/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('FN-01/FN-08 reset button is removed and triage shows progress and numbered retries', async () => {
  let renderer;
  let generation = 0;
  let calls = 0;
  let pendingTriage;
  let pendingRefresh;
  let fail = false;
  const result = { agent_model: 'test', ai_reasoning: 'test', policy_gate: 'test', unresponsive_count: 48, likely_away_count: 1, tasks_created: 1 };
  const snapshot = () => {
    const data = initial();
    data.issue = { ...data.issue, emergency_id: `em-${generation}`, issue_id: `issue-${generation}` };
    return data;
  };
  api.triggerEmergency = async () => {
    generation++;
    return { emergency_id: `em-${generation}`, issue_id: `issue-${generation}` };
  };
  api.getIssueDetail = async () => { if (pendingRefresh) await pendingRefresh.promise; return snapshot(); };
  api.startTriage = async () => {
    calls++;
    if (fail) throw new Error('triage offline');
    if (pendingTriage) await pendingTriage.promise;
    return result;
  };
  try {
    await act(async () => { renderer = create(React.createElement(StudioWorkspace)); });
    const cockpit = () => renderer.root.findByType(load('components/CockpitPanel.tsx').CockpitPanel);
    assert.doesNotMatch(text(renderer), /Firestore 50戸初期化/);
    assert.equal(cockpit().props.onResetDatabase, undefined);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    pendingTriage = deferred();
    pendingRefresh = deferred();
    const start = button(renderer, 'トリアージ開始').props.onClick;
    let request;
    await act(async () => { request = start(); void start(); });
    assert.equal(calls, 1);
    assert.equal(button(renderer, '1回目のトリアージ進行中').props.disabled, true);
    assert.equal(button(renderer, '1回目のトリアージ進行中').props['aria-busy'], true);
    await act(async () => { pendingTriage.resolve(); });
    assert.match(text(renderer), /1回目のトリアージ進行中/);
    await act(async () => { pendingRefresh.resolve(); await request; });
    pendingTriage = null;
    pendingRefresh = null;
    assert.match(text(renderer), /1回目のトリアージが完了しました/);
    assert.equal(button(renderer, '2回目のトリアージをする').props.disabled, false);
    await act(async () => { await button(renderer, '2回目のトリアージをする').props.onClick(); });
    assert.equal(calls, 2);
    assert.match(text(renderer), /2回目のトリアージが完了しました/);
    fail = true;
    await act(async () => { await button(renderer, '3回目のトリアージをする').props.onClick(); });
    assert.match(text(renderer), /3回目のトリアージに失敗しました/);
    assert.equal(button(renderer, '4回目のトリアージをする').props.disabled, false);
    assert.equal(cockpit().props.triageAiResult, null);
    fail = false;
    await act(async () => { await button(renderer, '4回目のトリアージをする').props.onClick(); });
    assert.match(text(renderer), /4回目のトリアージが完了しました/);
    await act(async () => { await cockpit().props.onTriggerEmergency(); });
    assert.ok(button(renderer, 'トリアージ開始'));
    assert.equal(cockpit().props.triageExecution.count, 0);
    assert.doesNotMatch(text(renderer), /4回目のトリアージが完了しました|Firestore 50戸初期化/);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('FN-09 audit log tab displays backend schema with data_used and data_disclosed', async () => {
  let renderer;
  const mockAuditEvent = {
    audit_event_id: 'aud-test-123',
    emergency_id: 'em-1',
    actor_type: 'RESIDENT',
    actor_id: 'resident-i',
    action: 'DISCLOSE_ROOM_NUMBER_ON_APPROVAL',
    target_type: 'TASK',
    target_id: 'task-check-302',
    data_used: ['resident_approval', 'task_id'],
    data_disclosed: ['unit_room_number:302'],
    occurred_at: '2026-10-11T08:15:30.000Z',
  };
  api.getMyAuditEvents = async () => ({ audit_events: [mockAuditEvent] });
  try {
    const persona = { id: 'resident-i', userId: 'resident-i', role: 'resident', unitId: 'unit-301', roomNumber: '301', name: '住民I (301号室)', isHelperCandidate: true };
    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: persona,
        user,
        emergencyId: null,
        tasks: [],
        issueDetail: null,
        onActionComplete: async () => {},
        isLoading: false,
      }));
    });
    // Tab 2: 記録 (history) をクリック
    const historyTabBtn = renderer.root.findAllByType('button').find((n) => contents(n).includes('記録'));
    assert.ok(historyTabBtn, '記録タブボタンが存在すること');
    await act(async () => {
      historyTabBtn.props.onClick();
    });
    const renderedText = text(renderer);
    assert.match(renderedText, /情報の利用記録/, '画面タイトルが表示されること');
    assert.match(renderedText, /協力承認に伴う部屋番号の限定開示/, 'actionが日本語化されて表示されること');
    assert.match(renderedText, /本人（resident-i）/, '操作主体が表示されること');
    assert.match(renderedText, /本人の協力承認/, 'data_usedのラベルが表示されること');
    assert.match(renderedText, /302号室/, 'data_disclosedの部屋番号が表示されること');
    assert.match(renderedText, /08:15/, 'occurred_atの時刻が表示されること');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('FN-08 CockpitPanel binds likely_away presence to outsideCount and away room status', async () => {
  let renderer;
  const { CockpitPanel } = load('components/CockpitPanel.tsx');
  const mockIssueDetail = {
    issue: { issue_id: 'issue-1', emergency_id: 'em-1', created_at: new Date().toISOString() },
    tasks: [],
    priority_targets: [],
    current_states_summary: { UNKNOWN: 50 },
    room_states: { '504': 'UNKNOWN' },
    likely_away_count: 1,
    likely_away_rooms: ['504'],
  };
  try {
    const adminPersona = { id: 'admin', userId: 'admin', role: 'admin', roomNumber: '000', name: '防災センター (管理人)', isHelperCandidate: false };
    await act(async () => {
      renderer = create(React.createElement(CockpitPanel, {
        activePersona: adminPersona,
        onSelectPersona: () => {},
        selectedEmergencyType: 'EARTHQUAKE',
        onSelectEmergencyType: () => {},
        emergencyId: 'em-1',
        issueId: 'issue-1',
        issueDetail: mockIssueDetail,
        triageAiResult: null,
        triageExecution: { count: 0, status: 'idle' },
        onTriggerEmergency: async () => {},
        onStartTriage: async () => {},
        onRefresh: async () => {},
        isLoading: false,
        logs: [],
        user,
        onLogin: async () => {},
        onLogout: async () => {},
      }));
    });
    const renderedText = text(renderer);
    assert.match(renderedText, /カレンダー外出中/, 'カレンダー外出中のラベルが存在すること');
    assert.match(renderedText, /1 戸/, '外出可能性カウントが1戸と表示されること');
    assert.match(renderedText, /49 戸/, '未応答カウントが在宅未応答49戸として表示されること');
    // FloorMap の rooms を検証
    const floorMap = renderer.root.findByType(load('components/ui/FloorMap.tsx').FloorMap);
    assert.ok(floorMap, 'FloorMapが存在すること');
    const room504 = floorMap.props.rooms.find((r) => r.roomNo === '504');
    assert.ok(room504, '504号室が存在すること');
    assert.equal(room504.status, 'away', '504号室がawayステータスであること');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('FN-06 taskCountdown and PhoneStage OFFERED countdown pill dynamically bind to expires_at', async () => {
  const { taskCountdown } = load('lib/emergency-view.ts');
  const now = 1700000000000;

  // 1. taskCountdown unit tests
  // expires_at is 45 seconds from now
  const expiresAt45s = new Date(now + 45_000).toISOString();
  assert.equal(taskCountdown(expiresAt45s, undefined, now), '0:45');

  // expires_at is 90 seconds from now
  const expiresAt90s = new Date(now + 90_000).toISOString();
  assert.equal(taskCountdown(expiresAt90s, undefined, now), '1:30');

  // expires_at is in the past -> clamps to 0:00
  const expiresAtPast = new Date(now - 10_000).toISOString();
  assert.equal(taskCountdown(expiresAtPast, undefined, now), '0:00');

  // Fallback to created_at + 60s
  const createdAt20sAgo = new Date(now - 20_000).toISOString();
  assert.equal(taskCountdown(undefined, createdAt20sAgo, now), '0:40');

  // Neither provided -> 0:00
  assert.equal(taskCountdown(undefined, undefined, now), '0:00');

  // 2. Component rendering test in PhoneStage
  let renderer;
  const mockTask = {
    task_id: 'task-test-offered',
    issue_id: 'issue-1',
    resident_id: 'resident-i',
    target_resident_id: 'resident-h',
    task_type: 'NEIGHBOR_CHECK',
    status: 'OFFERED',
    created_at: new Date(Date.now() - 30_000).toISOString(),
    expires_at: new Date(Date.now() + 30_000).toISOString(), // 30s remaining
  };
  api.getTaskDetail = async () => ({
    task: mockTask,
    is_disclosed: false,
    target_room_number: null,
    latest_event: {
      event_id: 'evt-1',
      task_id: mockTask.task_id,
      event_type: 'OFFERED',
      actor_type: 'BUILDING_AGENT',
      occurred_at: mockTask.created_at,
      expires_at: mockTask.expires_at,
    },
  });

  const detail = initial();
  detail.resident_states['resident-i'] = 'SAFE';
  detail.tasks = [mockTask];

  try {
    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1], // resident-i
        emergencyId: 'em-1',
        tasks: detail.tasks,
        issueDetail: detail,
        user,
        onActionComplete: async () => {},
      }));
    });

    const { CountdownPill } = load('components/ui/StatusAndInput.tsx');
    const pills = renderer.root.findAllByType(CountdownPill);
    const taskPill = pills.find((p) => p.props.label === '返事の期限 残り');
    assert.ok(taskPill, '返事の期限 残りのCountdownPillが存在すること');
    // 30秒残り（0:30）またはその近傍で描画されること（固定の "0:45" ではないこと）
    assert.match(taskPill.props.timeRemaining, /^0:(29|30|31)$/, '動的な残り時間（約0:30）が反映されていること');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('FN-03 / REQ-15 damage free text textarea exists and agent clarification question is displayed', async () => {
  let renderer;
  let sentMessage = null;

  api.confirmPresence = async (_, req) => {
    sentMessage = req.message;
    if (req.message === '水') {
      return {
        resident_id: 'resident-i',
        emergency_id: req.emergency_id,
        safety_status: 'NEED_HELP',
        observed_at: new Date().toISOString(),
        message: req.message,
        needs_clarification: true,
        clarification_question: 'どのような状況でしょうか？ お怪我や閉じ込めはありますか？',
      };
    }
    return {
      resident_id: 'resident-i',
      emergency_id: req.emergency_id,
      safety_status: 'NEED_HELP',
      observed_at: new Date().toISOString(),
      message: req.message,
      needs_clarification: false,
    };
  };

  const detail = initial();
  detail.resident_states['resident-i'] = 'UNKNOWN';
  try {
    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1], // resident-i
        emergencyId: 'em-1',
        tasks: [],
        issueDetail: detail,
        user,
        onActionComplete: async () => {},
      }));
    });

    // 1. 被害あり（ChoiceButton）をクリックして被害内容入力画面へ遷移
    const choiceButtons = renderer.root.findAllByType(load('components/ui/Buttons.tsx').ChoiceButton);
    const needHelpButton = choiceButtons.find((b) => b.props.title?.includes('被害あり'));
    assert.ok(needHelpButton, '被害ありのChoiceButtonが存在すること');
    await act(async () => {
      needHelpButton.props.onClick();
    });

    // 2. textarea が存在し、自由文を入力できること
    const textareas = renderer.root.findAllByType('textarea');
    assert.equal(textareas.length, 1, '自由記述textareaが存在すること');
    const textarea = textareas[0];

    // 「水」を入力して送信
    await act(async () => {
      textarea.props.onChange({ target: { value: '水' } });
    });

    const primaryButton = button(renderer, '管理人に送る');
    assert.ok(primaryButton, '管理人に送るボタンが存在すること');

    await act(async () => {
      await primaryButton.props.onClick();
    });

    assert.equal(sentMessage, '水');

    // 3. Resident Agent からの聞き返しバナーが描画されること
    const renderedText = text(renderer);
    assert.match(renderedText, /代理人（Resident Agent）より確認/, '代理人の聞き返しバナーが存在すること');
    assert.match(renderedText, /どのような状況でしょうか？ お怪我や閉じ込めはありますか？/, '聞き返し質問が表示されること');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('FN-01: StudioWorkspace がリロード・マウント時に getActiveEmergency でアクティブな災害とIssueを復元する', async () => {
  let activeEmergencyCalled = false;
  let issueDetailCalledWith = null;

  api.getActiveEmergency = async () => {
    activeEmergencyCalled = true;
    return {
      is_active: true,
      emergency_id: 'em-restore-123',
      issue_id: 'iss-restore-456',
      emergency_type: 'EARTHQUAKE',
      status: 'ACTIVE',
      instruction: '震度5強地震',
    };
  };

  const originalGetIssueDetail = api.getIssueDetail;
  api.getIssueDetail = async (_user, issueId, persona, emergencyId) => {
    issueDetailCalledWith = { issueId, emergencyId };
    return {
      issue: { issue_id: issueId, emergency_id: emergencyId, created_at: new Date().toISOString() },
      tasks: [],
      priority_targets: [],
      current_states_summary: { SAFE: 2, NEED_HELP: 1, UNKNOWN: 47 },
    };
  };

  let renderer;
  try {
    await act(async () => {
      renderer = create(React.createElement(StudioWorkspace));
    });

    assert.equal(activeEmergencyCalled, true, 'getActiveEmergency が呼び出されること');
    assert.deepEqual(
      issueDetailCalledWith,
      { issueId: 'iss-restore-456', emergencyId: 'em-restore-123' },
      '復元された issueId と emergencyId で getIssueDetail が実行されること'
    );
  } finally {
    api.getIssueDetail = originalGetIssueDetail;
    if (renderer) await act(async () => renderer.unmount());
  }
});



