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
// Settings as an OLDER version (<= 1.4.0) saved them: the editable image setting
// pointing at the retired comfyui-wan image. Written before main.js loads.
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ image: 'bishoy22/comfyui-wan:latest', onClose: 'stop' })
);
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

const fetched = []; // every URL the app asked for
const restCalls = []; // every RunPod REST call: { method, path, body }
let lastPodBody = null; // the last POST /pods body
let restDown = false; // simulate a dead RunPod host (DNS failure)

// RunPod API v2 (https://api.runpod.io/v2) — modelled on its published OpenAPI
// spec. Like the real server it REJECTS unknown request fields with 422.
const V2_CREATE_FIELDS = new Set([
  'name', 'image', 'cloud', 'gpu', 'cpu', 'disk', 'mounts', 'ports', 'env', 'args', 'cmd',
  'entrypoint', 'registry', 'dataCenterIds', 'globalNetworking', 'startJupyter', 'startSsh',
  'templateId', 'queue',
]);
const V2_GPU_FIELDS = new Set(['id', 'count', 'allowedCudaVersions', 'minCudaVersion', 'minRamPerGpu', 'minVcpuCountPerGpu']);
const err422 = (...errors) => json({ title: 'Unprocessable Entity', status: 422, detail: 'invalid request', errors }, 422);
const v2Pod = (id, p) => ({
  id, name: id, image: 'bishoy22/comfyui-studio:latest', args: '', disk: 50, ports: ['8188/http'], env: {},
  registry: null, status: p.status, actions: [], mounts: { persistent: { size: 100, path: '/workspace' } },
  gpu: { id: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', count: 1, vcpuCount: 16, memory: 64 },
  cloud: 'SECURE', dataCenterId: 'EU-RO-1', cudaVersion: '12.8', ssh: null, template: null, cost: 1.89,
  locked: false, globalNetworking: { enabled: false }, runtime: null,
  createdAt: '2026-11-20T10:00:00Z', startedAt: '2026-11-20T10:02:00Z',
});

global.fetch = async (url, init = {}) => {
  url = String(url);
  fetched.push(url);
  const method = (init.method || 'GET').toUpperCase();
  let m;
  if (url.startsWith('https://rest.runpod.io/')) {
    // the retired v1 host — it no longer resolves, exactly like in production
    const e = new TypeError('fetch failed');
    e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND rest.runpod.io'), { code: 'ENOTFOUND' });
    throw e;
  }
  if (url.startsWith('https://api.runpod.io/v2/')) {
    if (restDown) {
      const e = new TypeError('fetch failed');
      e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.runpod.io'), { code: 'ENOTFOUND' });
      throw e;
    }
    const rpath = url.slice('https://api.runpod.io/v2'.length);
    const body = init.body ? JSON.parse(init.body) : undefined;
    restCalls.push({ method, path: rpath, body });
    if (!/^Bearer \S+$/.test((init.headers || {}).Authorization || '')) {
      return json({ title: 'Unauthorized', status: 401, detail: 'missing or invalid API key' }, 401);
    }
    if (rpath === '/pods' && method === 'POST') {
      lastPodBody = body;
      const bad = Object.keys(body).filter((k) => !V2_CREATE_FIELDS.has(k)).map((k) => `$: additional properties '${k}' not allowed`);
      if (typeof body.name !== 'string' || !body.name) bad.push('$.name: required');
      if (!body.image) bad.push('$.image: required unless templateId is set');
      if (!body.gpu && !body.cpu) bad.push('$: supply exactly one of gpu or cpu');
      if (body.gpu) {
        if (!body.gpu.id) bad.push('$.gpu.id: required');
        for (const k of Object.keys(body.gpu)) if (!V2_GPU_FIELDS.has(k)) bad.push(`$.gpu: additional properties '${k}' not allowed`);
      }
      if (body.cloud && !['SECURE', 'COMMUNITY'].includes(body.cloud)) bad.push('$.cloud: must be SECURE or COMMUNITY');
      if (body.mounts && body.mounts.persistent && !(body.mounts.persistent.size >= 10)) bad.push('$.mounts.persistent.size: minimum 10');
      if (bad.length) return err422(...bad);
      const id = body.name; // tests choose the id via the pod name
      if (!pods[id]) pod(id);
      return json(v2Pod(id, { status: 'PROVISIONING' }), 201);
    }
    if (rpath.startsWith('/pods?') && method === 'GET') {
      const q = new URLSearchParams(rpath.split('?')[1]);
      const all = Object.keys(pods).map((id) => v2Pod(id, pods[id]));
      const start = Number(q.get('cursor') || 0), limit = Math.min(Number(q.get('limit') || 100), 2); // tiny pages
      const slice = all.slice(start, start + limit);
      const next = start + limit < all.length ? String(start + limit) : null;
      return json({ pods: slice, pagination: { nextCursor: next, hasNextPage: !!next } });
    }
    if ((m = rpath.match(/^\/pods\/([A-Za-z0-9]+)(\/action)?$/))) {
      const p = pods[m[1]];
      if (!p) return json({ title: 'Not Found', status: 404, detail: 'pod not found' }, 404);
      if (m[2] === '/action' && method === 'POST') {
        if (body.action === 'start') { p.status = 'RUNNING'; return json(v2Pod(m[1], p)); }
        if (body.action === 'stop') { p.status = 'EXITED'; return json(v2Pod(m[1], p)); }
        if (body.action === 'terminate') { delete pods[m[1]]; return Promise.resolve({ ok: true, status: 204, statusText: '', text: async () => '' }); }
        return err422('$.action: must be one of start, stop, restart, terminate');
      }
      if (!m[2] && method === 'GET') return json(v2Pod(m[1], p));
    }
    throw new Error('unexpected v2 call: ' + method + ' ' + rpath);
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
  // sign in (validateKey does GET /pods?limit=1 on the v2 API)
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

  await test('an image saved by an older version is dropped at startup, other settings kept', async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.ok(!('image' in saved), 'the stale comfyui-wan image is still in settings.json');
    assert.strictEqual(saved.onClose, 'stop', 'unrelated settings must survive the migration');
  });

  await test('the app only ever offers the Studio image, whatever is saved or asked for', async () => {
    const STUDIO = 'bishoy22/comfyui-studio:latest';
    assert.strictEqual((await call('settings:getDeployDefaults')).data.image, STUDIO);
    await call('settings:saveDeployDefaults', { image: 'evil/other:latest', containerDisk: 40 });
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
    assert.ok(!('image' in saved), 'saving must not be able to store an image');
    assert.strictEqual(saved.containerDisk, 40, 'other values are still saved');
    assert.strictEqual((await call('settings:getDeployDefaults')).data.image, STUDIO);
  });

  await test('createPod always deploys Studio, ignoring any image the UI sends', async () => {
    pod('wireimage01', { comfy: [502] });
    await call('runpod:createPod', { name: 'wireimage01', gpuTypeId: 'g', imageName: 'bishoy22/comfyui-wan:latest' });
    assert.strictEqual(lastPodBody.image, 'bishoy22/comfyui-studio:latest');
    await call('runpod:stopPod', 'wireimage01');
  });

  // ---- RunPod API v2 contract (the old rest.runpod.io/v1 host is gone) --------
  await test('every REST call goes to api.runpod.io/v2 — never the retired rest.runpod.io', async () => {
    assert.ok(restCalls.length > 0);
    assert.ok(!fetched.some((u) => u.startsWith('https://rest.runpod.io/')), 'something still talks to rest.runpod.io');
  });

  await test('createPod sends exactly the v2 schema (the fake server rejects anything else with 422)', async () => {
    pod('wirev2body1', { comfy: [502] });
    const r = await call('runpod:createPod', {
      name: 'wirev2body1', gpuTypeId: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', cloudType: 'COMMUNITY',
      containerDiskInGb: 40, volumeInGb: 180, env: { DOWNLOAD_LTX23_DEV_FP8: 'true' },
    });
    assert.strictEqual(r.ok, true, r.error);
    const b = lastPodBody;
    assert.strictEqual(b.image, 'bishoy22/comfyui-studio:latest');
    assert.strictEqual(b.cloud, 'COMMUNITY');
    assert.deepStrictEqual(b.gpu, { id: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', count: 1 });
    assert.strictEqual(b.disk, 40);
    assert.deepStrictEqual(b.mounts, { persistent: { size: 180, path: '/workspace' } });
    assert.ok(b.ports.includes('8188/http') && b.ports.includes('8189/http'));
    assert.strictEqual(b.env.DOWNLOAD_LTX23_DEV_FP8, 'true');
    for (const old of ['imageName', 'computeType', 'cloudType', 'gpuTypeIds', 'gpuCount', 'containerDiskInGb',
      'volumeInGb', 'volumeMountPath', 'dataCenterPriority', 'gpuTypePriority', 'interruptible']) {
      assert.ok(!(old in b), 'legacy v1 field still sent: ' + old);
    }
    await call('runpod:stopPod', 'wirev2body1');
  });

  await test('pods come back with the field names the UI reads (status, cost, GPU name, URLs)', async () => {
    pod('wirenorm001', { status: 'RUNNING', comfy: [502] });
    const r = await call('runpod:getPod', 'wirenorm001');
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.data.desiredStatus, 'RUNNING');
    assert.strictEqual(r.data.costPerHr, 1.89);
    assert.strictEqual(r.data.gpu.displayName, 'RTX PRO 6000 Blackwell Server Edition');
    assert.strictEqual(r.data.volumeInGb, 100);
    assert.strictEqual(r.data.comfyUrl, 'https://wirenorm001-8188.proxy.runpod.net');
    assert.strictEqual(r.data.image, 'bishoy22/comfyui-studio:latest');
    const created = await call('runpod:createPod', { name: 'wirenorm002', gpuTypeId: 'g' });
    assert.strictEqual(created.data.desiredStatus, 'PROVISIONING', 'a freshly created pod must carry a status');
    await call('runpod:stopPod', 'wirenorm002');
    await call('runpod:stopPod', 'wirenorm001');
  });

  await test('start / stop / terminate use POST /pods/{id}/action with the right verb', async () => {
    pod('wireact0001', { comfy: [502] });
    restCalls.length = 0;
    await call('runpod:stopPod', 'wireact0001');
    await call('runpod:startPod', 'wireact0001');
    const del = await call('runpod:deletePod', 'wireact0001');
    assert.strictEqual(del.ok, true, 'terminate answers 204 with no body and must not be an error');
    const acts = restCalls.filter((c) => c.path === '/pods/wireact0001/action');
    assert.deepStrictEqual(acts.map((c) => [c.method, c.body.action]), [['POST', 'stop'], ['POST', 'start'], ['POST', 'terminate']]);
    assert.ok(!restCalls.some((c) => /\/(stop|start)$/.test(c.path) || c.method === 'DELETE'), 'a v1-style call slipped through');
    assert.ok(!pods.wireact0001, 'the pod should be gone after terminate');
  });

  await test('listing pods follows every page, so the kill switch cannot miss one', async () => {
    for (let i = 1; i <= 5; i++) pod('wirepage000' + i, { comfy: [502] });
    const r = await call('runpod:listPods');
    assert.strictEqual(r.ok, true, r.error);
    const ids = r.data.map((p) => p.id);
    for (let i = 1; i <= 5; i++) assert.ok(ids.includes('wirepage000' + i), 'missing pod ' + i);
    for (let i = 1; i <= 5; i++) delete pods['wirepage000' + i];
  });

  await test('API errors show RunPod\'s own explanation, including field-level details', async () => {
    const r = await call('runpod:createPod', { name: 'wireerr00001', gpuTypeId: '' });
    assert.strictEqual(r.ok, false);
    assert.ok(/invalid request/.test(r.error) && /gpu\.id/.test(r.error), 'got: ' + r.error);
    const missing = await call('runpod:getPod', 'nosuchpod01');
    assert.strictEqual(missing.ok, false);
    assert.ok(/pod not found/.test(missing.error), 'got: ' + missing.error);
  });

  await test('the Logs tab gets its entries in the { ok, data } envelope, with secrets redacted', async () => {
    await call('settings:saveHfToken', 'hf_logleaktest123');
    pod('wirelog0001', { comfy: [502] });
    await call('runpod:createPod', { name: 'wirelog0001', gpuTypeId: 'g' });
    const r = await call('logs:get');
    assert.strictEqual(r.ok, true);
    assert.ok(Array.isArray(r.data) && r.data.length > 0, 'logs came back empty');
    assert.ok(r.data.some((e) => e.level && e.msg && /REST POST \/pods/.test(e.msg)), 'the create request is not in the log');
    const all = JSON.stringify(r.data);
    assert.ok(!all.includes('hf_logleaktest123') && !all.includes('rpa_fake_key_for_test'), 'a secret is visible in the log');
    await call('runpod:stopPod', 'wirelog0001');
    assert.strictEqual((await call('logs:clear')).ok, true);
    assert.strictEqual((await call('logs:get')).data.length, 0, 'clear did not empty the buffer');
  });

  await test('a network failure reports the real cause instead of just "fetch failed"', async () => {
    restDown = true;
    try {
      const r = await call('runpod:listPods');
      assert.strictEqual(r.ok, false);
      assert.ok(/ENOTFOUND/.test(r.error), 'the DNS error code is missing: ' + r.error);
    } finally {
      restDown = false;
    }
  });

  await test('the model catalog is only ever requested for the Studio image', async () => {
    fetched.length = 0;
    const r = await call('runpod:modelManifest', 'evil/other:latest'); // the argument must be ignored
    assert.strictEqual(r.ok, false); // the fake network has no registry; what matters is WHICH repo was asked for
    const asked = fetched.filter((u) => u.includes('repository:'));
    assert.ok(asked.length > 0, 'it did not even try to read the image');
    assert.ok(asked.every((u) => u.includes('repository:bishoy22/comfyui-studio:')), 'asked for: ' + asked.join(', '));
  });

  await test('"Forget saved keys" removes BOTH the RunPod key and the HuggingFace token', async () => {
    await call('settings:saveHfToken', 'hf_fake_token_for_test_only');
    assert.ok(fs.existsSync(path.join(userData, 'apikey.bin')), 'precondition: key saved');
    assert.ok(fs.existsSync(path.join(userData, 'hftoken.bin')), 'precondition: token saved');

    // secrets must never be written anywhere readable, in particular not settings.json
    const settingsText = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
    assert.ok(!settingsText.includes('rpa_') && !settingsText.includes('hf_'), 'a secret leaked into settings.json');

    // a pod being watched must not be opened once the account is forgotten
    pod('wireforget01', { comfy: [502, 502, 502] });
    await call('runpod:createPod', { name: 'wireforget01', gpuTypeId: 'g' });

    const r = await call('settings:forgetKeys');
    assert.deepStrictEqual(r.data, { apiKey: false, hfToken: false });
    assert.ok(!fs.existsSync(path.join(userData, 'apikey.bin')), 'apikey.bin still on disk');
    assert.ok(!fs.existsSync(path.join(userData, 'hftoken.bin')), 'hftoken.bin still on disk');
    assert.strictEqual((await call('settings:hasApiKey')).data, false);
    assert.strictEqual((await call('settings:hasHfToken')).data, false);

    pods.wireforget01.comfy = [200]; // it would open now if it were still being watched
    await settleMs(150);
    assert.ok(!opened.includes(url('wireforget01')), 'the watcher kept running after keys were forgotten');
  });

  console.log(out.join('\n'));
  console.log(`\n${passed} passed, ${out.length - passed} failed`);
  process.exit(process.exitCode || 0);
})();
