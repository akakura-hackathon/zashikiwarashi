// FN-02 / FN-06 / FN-08: Exercise display boundaries and the API login gate.
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
const { safetyCountdown, safetyRoomStatus } = load('../lib/emergency-view.ts');
test('countdown uses elapsed wall time and remains zero after the guide time', () => {
  const issued = '2026-10-06T00:00:00Z';
  const start = Date.parse(issued);
  for (const [elapsed, expected] of [[0, '2:00'], [18000, '1:42'], [119001, '0:01'], [120000, '0:00'], [300000, '0:00']]) {
    assert.equal(safetyCountdown(issued, start + elapsed), expected);
  }
  assert.equal(safetyCountdown(undefined, start), '--:--');
});
test('map never treats unanswered or missing data as safe', () => {
  assert.equal(safetyRoomStatus(undefined), 'unresponsive');
  assert.equal(safetyRoomStatus('UNKNOWN'), 'unresponsive');
  assert.equal(safetyRoomStatus('SAFE'), 'safe');
  assert.equal(safetyRoomStatus('NEED_HELP'), 'urgent');
  assert.equal(safetyRoomStatus('OUTSIDE_BUILDING'), 'away');
});
test('API refuses missing/anonymous sessions and token failures before fetch', async () => {
  const { apiFetch } = load('../lib/api-client.ts');
  await assert.rejects(apiFetch(null, '/emergency/confirm-presence'), { status: 401 });
  await assert.rejects(apiFetch({ isAnonymous: true }, '/emergency/confirm-presence'), { status: 401 });
  const expired = new Error('token expired');
  await assert.rejects(apiFetch({ isAnonymous: false, getIdToken: async () => { throw expired; } }, '/issues/demo'), expired);
});
