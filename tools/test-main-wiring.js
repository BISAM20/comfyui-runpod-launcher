// End-to-end check of the auto-open wiring in electron/main.js.
//
// Loads the REAL main process with Electron, the network and the clock faked at
// the edges, then drives the real IPC handlers the UI calls. Proves that
// creating/starting a pod arms the watcher and that the browser is opened.
//
// Run:  node tools/test-main-wiring.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// --- fake Electron ------------------------------------------------------------
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-wiring-'));
const handlers = new Map();
const opened = [];
const sent = [];

class FakeWindow {
  constructor() {
    this.webContents = { send: (ch, payload) => sent.push({ ch, payload }) };
  }
  loadFile() {}
  on() {}
  isDestroyed() { return false; }
  destroy() {}
  static getAllWindows() { return [1]; }
}
const fakeElectron = {
  app: { whenReady: () => Promise.resolve(), on() {}, quit() {}, getPath: () => userData },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  shell: { openExternal: async (u) => { opened.push(u); } },
  safeStorage: { isEncryptionAvailable: () => false },
  contextBridge: {},
  ipcRenderer: {},
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? fakeElectron : origLoad.call(this, request, ...rest);
};

// --- fake RunPod + pod proxy --------------------------------------------------
const pods = {}; // id -> { status, comfyUp:[...answers], logs:[...texts], calls }
function pod(id, opts = {}) {
  pods[id] = { status: 'RUNNING', comfy: [502, 502, 200], logs: ['x'], calls: { comfy: 0, logs: 0 }, ...opts };
  return pods[id];
}
const json = (obj, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: '', text: async () => JSON.stringify(obj), json: async () => obj });
const text = (t, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: '', text: async () => t, json: async () => ({}) });

global.fetch = async (url, init = {}) => {
  url = String(url);
  const method = (init.method || 'GET').toUpperCase();
  let m;
  if (url === 'https://rest.runpod.io/v1/pods' && method === 'POST') {
    const body = JSON.parse(init.body);
    const id = body.name; // tests choose the id via the pod name
    if (!pods[id]) pod(id);
    return json({ id, desiredStatus: 'RUNNING' }, 201);
  }
  if (url === 'https://rest.runpod.io/v1/pods' && method === 'GET') return json([]);
  if ((m = url.match(/^https:\/\/rest\.runpod\.io\/v1\/pods\/([a-z0-9]+)(\/start|\/stop)?$/))) {
    const p = pods[m[1]];
    if (!p) return json({ error: 'pod not found' }, 404);
    if (m[2] === '/start') { p.status = 'RUNNING'; return json({}, 200); }
    if (m[2] === '/stop') { p.status = 'EXITED'; return json({}, 200); }
    if (method === 'DELETE') { delete pods[m[1]]; return json({}, 200); }
    return json({ id: m[1], desiredStatus: p.status });
  }
  if ((m = url.match(/^https:\/\/([a-z0-9]+)-8188\.proxy\.runpod\.net\/$/))) {
    const p = pods[m[1]];
    const seq = p ? p.comfy : [502];
    const status = seq[Math.min(p ? p.calls.comfy++ : 0, seq.length - 1)];
    return { status, ok: status < 400 };
  }
  if ((m = url.match(/^https:\/\/([a-z0-9]+)-8189\.proxy\.runpod\.net\/([a-z]+\.log)$/))) {
    const p = pods[m[1]];
    if (!p) return text('', 404);
    const i = Math.min(p.calls.logs, p.logs.length - 1);
    if (m[2] === 'downloads.log') { p.calls.logs++; return text(p.logs[i]); }
    if (m[2] === 'progress.log') return text(p.progress || 'Starting model downloads in the background');
    return text('', 404);
  }
  throw new Error('unexpected fetch: ' + method + ' ' + url);
};

// Compress waits: the watcher sleeps 8-20 s between checks. Real timers only
// for short delays, so abort timers etc. behave as normal.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...a);

// --- load the real main process ---------------------------------------------
require('../electron/main.js');

const call = async (ch, ...args) => {
  const h = handlers.get(ch);
  assert.ok(h, 'no handler registered for ' + ch);
  return h({}, ...args);
};
const until = async (cond, label, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await new Promise((r) => realSetTimeout(r, 5));
  }
  throw new Error('timed out waiting for: ' + label);
};
const settleMs = (ms) => new Promise((r) => realSetTimeout(r, ms));
const url = (id) => `https://${id}-8188.proxy.runpod.net/`;

let passed = 0;
const out = [];
async function test(name, fn) {
  try { await fn(); passed++; out.push('  ok   ' + name); }
  catch (e) { process.exitCode = 1; out.push('  FAIL ' + name + '\n       ' + e.message); }
}

(async () => {
  // sign in (validateKey does GET /pods)
  const key = await call('settings:validateAndSave', 'rpa_fake_key_for_test');
  assert.strictEqual(key.ok, true, 'could not save the fake key');

  await test('default setting is "ready" (on) when nothing has been saved', async () => {
    const r = await call('settings:getDeployDefaults');
    assert.strictEqual(r.data.autoOpen, 'ready');
  });

  await test('creating a pod opens ComfyUI in the browser once it is reachable', async () => {
    pod('wireready01', { comfy: [502, 502, 200, 200] });
    const r = await call('runpod:createPod', { name: 'wireready01', gpuTypeId: 'g' });
    assert.strictEqual(r.ok, true);
    await until(() => opened.includes(url('wireready01')), 'browser opened');
    assert.strictEqual(opened.filter((u) => u === url('wireready01')).length, 1, 'opened exactly once');
    assert.ok(sent.some((s) => s.ch === 'pod:autoOpen' && s.payload.type === 'opened' && s.payload.podId === 'wireready01'),
      'UI was told it opened');
  });

  await test('it does NOT open while ComfyUI is still booting', async () => {
    const p = pod('wireboot001', { comfy: [502] }); // never comes up
    await call('runpod:createPod', { name: 'wireboot001', gpuTypeId: 'g' });
    await settleMs(150);
    assert.ok(!opened.includes(url('wireboot001')));
    assert.ok(p.calls.comfy > 3, 'kept polling');
    await call('runpod:stopPod', 'wireboot001'); // cancels the watcher
  });

  await test('setting persists to settings.json and an invalid mode falls back to "ready"', async () => {
    assert.strictEqual((await call('settings:setAutoOpen', 'downloads')).data, 'downloads');
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.strictEqual(saved.autoOpen, 'downloads');
    assert.strictEqual((await call('settings:setAutoOpen', 'bogus')).data, 'ready');
    assert.strictEqual((await call('settings:getDeployDefaults')).data.autoOpen, 'ready');
  });

  await test('"off" never opens the browser', async () => {
    await call('settings:setAutoOpen', 'off');
    pod('wireoff0001', { comfy: [200] });
    await call('runpod:createPod', { name: 'wireoff0001', gpuTypeId: 'g' });
    await settleMs(150);
    assert.ok(!opened.includes(url('wireoff0001')));
    await call('runpod:stopPod', 'wireoff0001');
  });

  await test('"downloads" waits for the downloads, then opens', async () => {
    await call('settings:setAutoOpen', 'downloads');
    const running = '[DOWNLOADS] Starting: now\n[DL] big model';
    const done = '[DOWNLOADS] Starting: now\n[DOWNLOADS] All done: later';
    pod('wiredown001', { comfy: [200], logs: [running, running, running, done] });
    await call('runpod:createPod', { name: 'wiredown001', gpuTypeId: 'g' });
    await until(() => opened.includes(url('wiredown001')), 'opened after downloads');
    assert.ok(pods.wiredown001.calls.logs >= 4, 'it kept checking until "All done"');
    assert.ok(sent.some((s) => s.payload && s.payload.type === 'waiting-downloads'), 'user was told it is waiting');
  });

  await test('stopping a pod cancels its pending auto-open', async () => {
    await call('settings:setAutoOpen', 'ready');
    pod('wirestop001', { comfy: [502, 502, 502, 502, 502, 200] });
    await call('runpod:createPod', { name: 'wirestop001', gpuTypeId: 'g' });
    await call('runpod:stopPod', 'wirestop001');
    pods.wirestop001.comfy = [200]; // it would open now, if still watching
    await settleMs(150);
    assert.ok(!opened.includes(url('wirestop001')));
  });

  await test('starting an existing pod arms the watcher too', async () => {
    pod('wirestart01', { status: 'EXITED', comfy: [200, 200] });
    const r = await call('runpod:startPod', 'wirestart01');
    assert.strictEqual(r.ok, true);
    await until(() => opened.includes(url('wirestart01')), 'opened after start');
  });

  await test('terminating a pod cancels its watcher without error', async () => {
    pod('wiredel0001', { comfy: [502] });
    await call('runpod:createPod', { name: 'wiredel0001', gpuTypeId: 'g' });
    const r = await call('runpod:deletePod', 'wiredel0001');
    assert.strictEqual(r.ok, true);
    await settleMs(100);
    assert.ok(!opened.includes(url('wiredel0001')));
  });

  console.log(out.join('\n'));
  console.log(`\n${passed} passed, ${out.length - passed} failed`);
  process.exit(process.exitCode || 0);
})();
