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

test('Issue #34: 4大災害シナリオ（停電・火災・洪水・地震）の打診タスクが災害固有のタイトルと時間で表示される', async () => {
  let renderer;
  const originalGetTaskDetail = api.getTaskDetail;
  try {
    const supplyRelayTask = {
      task_id: 'task-relay-1',
      issue_id: 'iss-outage-1',
      resident_id: 'resident-i',
      target_resident_id: 'resident-h',
      task_type: 'SUPPLY_RELAY',
      title: '飲料水の階段リレー運搬',
      description: '全館停電・エレベーター停止のため、指定踊り場への物資リレー運搬を依頼します。',
      estimated_seconds: 240,
      status: 'OFFERED',
      created_at: new Date(Date.now() - 30_000).toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    };

    api.getTaskDetail = async () => ({
      task: supplyRelayTask,
      is_disclosed: false,
      target_room_number: null,
      latest_event: {
        event_id: 'evt-relay-1',
        task_id: supplyRelayTask.task_id,
        event_type: 'OFFERED',
        actor_type: 'BUILDING_AGENT',
        occurred_at: supplyRelayTask.created_at,
        expires_at: supplyRelayTask.expires_at,
      },
    });

    const detail = initial();
    detail.resident_states['resident-i'] = 'SAFE';
    detail.tasks = [supplyRelayTask];

    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-outage-1',
        emergencyType: 'POWER_OUTAGE',
        tasks: [supplyRelayTask],
        issueDetail: detail,
        user,
        onActionComplete: async () => {},
      }));
    });

    const rendered = text(renderer);
    assert.match(rendered, /飲料水の階段リレー運搬/, '停電シナリオのタスク名が表示されること');
    assert.match(rendered, /約4分/, '推定所要時間が約4分と表示されること');
    assert.match(rendered, /階段移動が可能なため/, '停電リレー運搬の依頼理由が表示されること');
  } finally {
    api.getTaskDetail = originalGetTaskDetail;
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('Issue #40: SC-1 停電シナリオの困りごと選択画面（S1_A2）と階段リレー運搬（S1_C3/S1_C4）画面の検証', async () => {
  let renderer;
  const originalGetTaskDetail = api.getTaskDetail;
  try {
    // 1. 困りごと入力画面の検証（S1_A2）
    const detail = initial();
    detail.resident_states['resident-i'] = 'UNKNOWN';
    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-outage-2',
        emergencyType: 'POWER_OUTAGE',
        tasks: [],
        issueDetail: detail,
        user,
        onActionComplete: async () => {},
      }));
    });

    // 「困っている」をタップして困りごと詳細へ遷移
    const needHelpBtn = button(renderer, '困っている（');
    assert.ok(needHelpBtn, '停電時用の「困っている」選択ボタンが存在すること');
    await act(async () => {
      needHelpBtn.props.onClick();
    });

    const renderedNeed = text(renderer);
    assert.match(renderedNeed, /停電時の困りごとを教えてください/, '停電時の困りごとタイトルが表示されること');
    assert.match(renderedNeed, /飲み水・食料が足りない/, '飲み水・食料不足の選択肢が表示されること');
    assert.match(renderedNeed, /階段を自力で昇降できない/, '階段昇降困難の選択肢が表示されること');
    assert.match(renderedNeed, /薬が足りない・医療機器が使えない/, '薬・医療機器の選択肢が表示されること');
    assert.match(renderedNeed, /暑さ・寒さで体調が不安/, '熱中症・体調不安の選択肢が表示されること');
    assert.doesNotMatch(renderedNeed, /大型家具の転倒/, '地震向けの家具転倒選択肢は表示されないこと');

    await act(async () => renderer.unmount());

    // 2. 承認後運搬手順（S1_C3）と報告画面（S1_C4）の検証
    const relayTask = {
      task_id: 'task-relay-step',
      issue_id: 'iss-outage-2',
      resident_id: 'resident-i',
      target_resident_id: 'resident-h',
      task_type: 'SUPPLY_RELAY',
      title: '飲料水の階段リレー運搬',
      description: '指定踊り場への物資リレー運搬を依頼します。',
      estimated_seconds: 240,
      status: 'APPROVED',
      created_at: new Date(Date.now() - 30_000).toISOString(),
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    };

    api.getTaskDetail = async () => ({
      task: relayTask,
      is_disclosed: true,
      target_room_number: '101',
      latest_event: {
        event_id: 'evt-relay-2',
        task_id: relayTask.task_id,
        event_type: 'APPROVED',
        actor_type: 'RESIDENT',
        occurred_at: relayTask.created_at,
      },
    });

    const detailWithTask = initial();
    detailWithTask.resident_states['resident-i'] = 'SAFE';
    detailWithTask.tasks = [relayTask];

    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-outage-2',
        emergencyType: 'POWER_OUTAGE',
        tasks: [relayTask],
        issueDetail: detailWithTask,
        user,
        onActionComplete: async () => {},
      }));
    });

    const renderedRelay = text(renderer);
    assert.match(renderedRelay, /物資の受取場所と運搬先/, '物資受取場所タイトルが表示されること');
    assert.match(renderedRelay, /101/, '受取場所として開示された部屋番号が表示されること');
    assert.match(renderedRelay, /指定階（8階踊り場）の「ZASHIKI箱」へ運んで置きます/, '階段リレー運搬の手順案内が表示されること');

    // 「報告する」ボタンを押して R07 へ
    const reportBtns = renderer.root.findAll((el) => el.props && el.props.children && typeof el.props.children === 'string' && el.props.children.includes('報告する'));
    assert.ok(reportBtns.length > 0, '踊り場到着報告ボタンが存在すること');
    await act(async () => {
      reportBtns[0].props.onClick();
    });

    const renderedReport = text(renderer);
    assert.match(renderedReport, /踊り場に置けましたか？/, '階段リレーの完了報告タイトルが表示されること');
    assert.match(renderedReport, /指定の踊り場に置いた/, '踊り場設置完了の選択肢が表示されること');
    assert.match(renderedReport, /置けなかった（危険・途中で断念）/, 'リレー中断の選択肢が表示されること');
  } finally {
    api.getTaskDetail = originalGetTaskDetail;
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('Issue #41: SC-2 火災シナリオの避難状況選択（S2_E1）と避難同行タスク（S2_F2/S2_F3）画面の検証', async () => {
  const originalGetTaskDetail = api.getTaskDetail;
  let renderer;
  const user = { uid: 'u-resident-i', getIdToken: async () => 'test-token' };

  try {
    // 1. 避難状況・被害選択画面（S2_E1）の検証
    const detailWithoutTask = initial();
    detailWithoutTask.resident_states['resident-i'] = 'UNKNOWN';

    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-fire-1',
        emergencyType: 'FIRE',
        tasks: [],
        issueDetail: detailWithoutTask,
        user,
        onActionComplete: async () => {},
      }));
    });

    // 「手伝い・同行が必要」を押して S2_E1 被害画面へ
    const needHelpButton = button(renderer, '避難に手助け・同行が必要');
    assert.ok(needHelpButton, '火災用同行支援要請ボタンが存在すること');
    await act(async () => {
      needHelpButton.props.onClick();
    });

    const renderedNeed = text(renderer);
    assert.match(renderedNeed, /避難の状況を教えてください/, '火災避難の状況タイトルが表示されること');
    assert.match(renderedNeed, /階段を自力で降りられない（避難同行が必要）/, '階段歩行困難・避難同行の選択肢が表示されること');
    assert.match(renderedNeed, /煙が充満している・火が見える/, '煙充満・火災視認の選択肢が表示されること');
    assert.match(renderedNeed, /けがをしている・動けない/, 'けが・動けない選択肢が表示されること');
    assert.match(renderedNeed, /逃げ道・ドアが遮断されている/, '避難経路遮断の選択肢が表示されること');

    await act(async () => renderer.unmount());

    // 2. 承認後同行手順（S2_F2）と報告画面（S2_F3）の検証
    const escortTask = {
      task_id: 'task-fire-escort',
      issue_id: 'iss-fire-1',
      resident_id: 'resident-i',
      target_resident_id: 'resident-h',
      task_type: 'EVACUATION_ESCORT',
      title: '西側非常階段への避難同行',
      description: '同一階の要配慮住戸の方と合流し、西側非常階段まで同行避難をお願いします。',
      estimated_seconds: 30,
      status: 'APPROVED',
      created_at: new Date(Date.now() - 10_000).toISOString(),
      expires_at: new Date(Date.now() + 20_000).toISOString(),
    };

    api.getTaskDetail = async () => ({
      task: escortTask,
      is_disclosed: true,
      target_room_number: '805',
      latest_event: {
        event_id: 'evt-escort-1',
        task_id: escortTask.task_id,
        event_type: 'APPROVED',
        actor_type: 'RESIDENT',
        occurred_at: escortTask.created_at,
      },
    });

    const detailWithTask = initial();
    detailWithTask.resident_states['resident-i'] = 'SAFE';
    detailWithTask.tasks = [escortTask];

    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-fire-1',
        emergencyType: 'FIRE',
        tasks: [escortTask],
        issueDetail: detailWithTask,
        user,
        onActionComplete: async () => {},
      }));
    });

    const renderedEscort = text(renderer);
    assert.match(renderedEscort, /合流場所と避難ルート/, '合流場所タイトルが表示されること');
    assert.match(renderedEscort, /805/, '合流先として開示された部屋番号が表示されること');
    assert.match(renderedEscort, /合流場所（西側非常階段ルート上）/, '西側非常階段ルートの表示があること');
    assert.match(renderedEscort, /姿勢を低く保ち、エレベーターは絶対に使用しないでください/, '煙・EV禁止の警告が表示されること');

    // 「報告する」ボタンを押して S2_F3 へ
    const reportBtn = button(renderer, '報告');
    assert.ok(reportBtn, '避難開始・報告ボタンが存在すること');
    await act(async () => {
      reportBtn.props.onClick();
    });

    const renderedReport = text(renderer);
    assert.match(renderedReport, /地上集合場所に到着しましたか？/, '避難同行の完了報告タイトルが表示されること');
    assert.match(renderedReport, /同行して地上（西側駐車場）へ到着した/, '同行退避完了の選択肢が表示されること');
    assert.match(renderedReport, /相手の部屋に応答がなく、先行して避難した/, '相手不在時の先行避難選択肢が表示されること');
    assert.match(renderedReport, /煙や火災で合流できず、自身を優先して避難した/, '煙による避難断念の選択肢が表示されること');
  } finally {
    api.getTaskDetail = originalGetTaskDetail;
    if (renderer) await act(async () => renderer.unmount());
  }
});

test('SC-4 flood scenario renders vertical evacuation detail, waiting screen, task escort, and arrival report', async () => {
  let renderer;
  const originalGetTaskDetail = api.getTaskDetail;

  try {
    // 1. S4_L1: 洪水・垂直避難状況の詳細選択画面
    const detailL1 = initial();
    detailL1.resident_states['resident-h'] = 'UNKNOWN';

    await act(async () => {
      renderer = create(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[2],
        emergencyId: 'em-flood-1',
        emergencyType: 'FLOOD',
        tasks: [],
        issueDetail: detailL1,
        user,
        onActionComplete: async () => {},
      }));
    });

    // 「手助けが必要」ボタンを押して damage_detail へ
    const needHelpBtn = button(renderer, '手助け・同行が必要');
    assert.ok(needHelpBtn, '垂直避難の手助け・同行が必要ボタンが存在すること');
    await act(async () => {
      needHelpBtn.props.onClick();
    });

    const renderedL1 = text(renderer);
    assert.match(renderedL1, /垂直避難の状況を教えてください/, '垂直避難状況のタイトルが表示されること');
    assert.match(renderedL1, /自力で上層階へ階段を上がれない/, '階段不可チェック項目が表示されること');
    assert.match(renderedL1, /室内や玄関まで浸水している/, '浸水チェック項目が表示されること');
    assert.match(renderedL1, /停電で足元が暗く動けない・けが/, '暗闇・けがチェック項目が表示されること');
    assert.match(renderedL1, /乳幼児・要介助者がいて移動が困難/, '介助者移動困難チェック項目が表示されること');

    // 送信ボタンを押して待機画面へ遷移
    const sendBtn = button(renderer, '管理人に送る');
    assert.ok(sendBtn, '管理人に送るボタンが存在すること');
    await act(async () => {
      sendBtn.props.onClick();
    });

    // 2. S4_L2: 垂直避難同行の待機画面
    const detailL2 = initial();
    detailL2.resident_states['resident-h'] = 'NEED_HELP';

    await act(async () => {
      renderer.update(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[2],
        emergencyId: 'em-flood-1',
        emergencyType: 'FLOOD',
        tasks: [],
        issueDetail: detailL2,
        user,
        onActionComplete: async () => {},
      }));
    });

    const renderedL2 = text(renderer);
    assert.match(renderedL2, /垂直避難同行の手配状況/, '手配状況タイトルが表示されること');
    assert.match(renderedL2, /垂直避難の準備・待機時の心得/, '心得バッジが表示されること');
    assert.match(renderedL2, /上層階へ自力避難・119番通報/, '自力避難の注記が表示されること');

    // 3. S4_M2 & S4_M3: 承認後画面と6階共用ラウンジ到着報告
    const verticalTask = {
      task_id: 'task-vertical-1',
      issue_id: 'issue-flood-1',
      resident_id: 'resident-i',
      target_resident_id: 'resident-h',
      task_type: 'VERTICAL_EVACUATION',
      title: '上層階への垂直避難同行',
      description: '浸水警戒区域のため、上層階（6階以上）への垂直避難への同行支援を依頼します。',
      estimated_seconds: 60,
      status: 'APPROVED',
      created_at: new Date(Date.now() - 10_000).toISOString(),
      expires_at: new Date(Date.now() + 50_000).toISOString(),
    };

    api.getTaskDetail = async () => ({
      task: verticalTask,
      is_disclosed: true,
      target_room_number: '102',
      latest_event: {
        event_id: 'evt-vertical-1',
        task_id: verticalTask.task_id,
        event_type: 'APPROVED',
        actor_type: 'RESIDENT',
        occurred_at: verticalTask.created_at,
      },
    });

    const detailWithTask = initial();
    detailWithTask.resident_states['resident-i'] = 'SAFE';
    detailWithTask.tasks = [verticalTask];

    await act(async () => {
      renderer.update(React.createElement(PhoneStage, {
        activePersona: api.DEMO_PERSONAS[1],
        emergencyId: 'em-flood-1',
        emergencyType: 'FLOOD',
        tasks: [verticalTask],
        issueDetail: detailWithTask,
        user,
        onActionComplete: async () => {},
      }));
    });

    const renderedM2 = text(renderer);
    assert.match(renderedM2, /合流場所と垂直避難先/, '合流場所と垂直避難先タイトルが表示されること');
    assert.match(renderedM2, /102/, '開示された部屋番号が表示されること');
    assert.match(renderedM2, /合流場所（低層階・上方向避難ルート上）/, '低層階・上方向避難ルートの表示があること');
    assert.match(renderedM2, /浸水に注意し、エレベーターは絶対に使用せず非常階段で6階へ向かってください/, '浸水注意バッジが表示されること');

    // 「報告する」ボタンを押して S4_M3 へ
    const reportBtn = button(renderer, '報告');
    assert.ok(reportBtn, '報告画面へ進むボタンが存在すること');
    await act(async () => {
      reportBtn.props.onClick();
    });

    const renderedM3 = text(renderer);
    assert.match(renderedM3, /6階共用ラウンジに到着しましたか？/, '到着報告タイトルが表示されること');
    assert.match(renderedM3, /同行して6階共用ラウンジへ到着した/, '退避完了選択肢が表示されること');
    assert.match(renderedM3, /相手の部屋に応答がなく、先行して上階へ避難した/, '先行上階退避選択肢が表示されること');
    assert.match(renderedM3, /浸水・危険のため合流できず、自身を優先して退避した/, '浸水断念選択肢が表示されること');
  } finally {
    api.getTaskDetail = originalGetTaskDetail;
    if (renderer) await act(async () => renderer.unmount());
  }
});





