// Tests for electron/autoopen.js — no Electron, no network.
// Run:  node tools/test-autoopen.js
const assert = require('assert');
const { createAutoOpener, downloadsFinished } = require('../electron/autoopen');

let passed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    results.push(`  ok   ${name}`);
  } catch (e) {
    results.push(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

// --- harness ---------------------------------------------------------------
// A fake clock: sleeping just advances time, so a 6-hour timeout is instant.
function harness({ mode = 'ready', pod, probe, logs, timing } = {}) {
  const h = {
    t: 0,
    mode,
    opened: [],
    events: [],
    calls: { getPod: 0, probe: 0, logs: 0 },
    infoLogs: [],
  };
  const seq = (src, fallback) => {
    let i = 0;
    return (...a) => {
      const v = typeof src === 'function' ? src(...a) : Array.isArray(src) ? src[Math.min(i++, src.length - 1)] : src;
      return v === undefined ? fallback : v;
    };
  };
  const nextPod = seq(pod, { desiredStatus: 'RUNNING' });
  const nextProbe = seq(probe, { reachable: true });
  const nextLogs = seq(logs, null);

  h.opener = createAutoOpener({
    getMode: () => h.mode,
    getPod: async (id) => {
      h.calls.getPod += 1;
      const v = nextPod(id);
      if (v instanceof Error) throw v;
      return v;
    },
    probeComfy: async (id) => {
      h.calls.probe += 1;
      return nextProbe(id);
    },
    fetchPodLogs: async (id) => {
      h.calls.logs += 1;
      const v = nextLogs(id);
      if (v instanceof Error) throw v;
      return v;
    },
    open: async (url) => h.opened.push(url),
    notify: (e) => h.events.push(e),
    log: { info: (m) => h.infoLogs.push(m), ok() {}, error: (m) => h.infoLogs.push('ERR ' + m) },
    sleep: async (ms) => {
      h.t += ms;
      h.sleeps = (h.sleeps || 0) + 1;
      if (h.onSleep) h.onSleep(h.sleeps);
      await new Promise((r) => setImmediate(r));
    },
    now: () => h.t,
    timing,
  });
  return h;
}

// Wait for every watcher to finish.
async function settle(h, limit = 5000) {
  for (let i = 0; i < limit && h.opener.size() > 0; i++) {
    await new Promise((r) => setImmediate(r));
  }
  assert.strictEqual(h.opener.size(), 0, 'watcher never finished');
}

const logsText = (progress, downloads) =>
  `===== progress.log =====\n${progress}\n\n===== downloads.log =====\n${downloads}`;
const START = '[DOWNLOADS] Starting: Mon';
const DONE = '[DOWNLOADS] All done: Mon';

(async () => {
  // ---- downloadsFinished (pure) --------------------------------------------
  await test('downloadsFinished: run started, not finished -> false', () => {
    assert.strictEqual(downloadsFinished(logsText('Starting model downloads in the background', START + '\n[DL] x')), false);
  });
  await test('downloadsFinished: run finished -> true', () => {
    assert.strictEqual(downloadsFinished(logsText('Starting model downloads in the background', START + '\n' + DONE)), true);
  });
  await test('downloadsFinished: an OLDER finished run does not count once a new one starts', () => {
    const dl = `${START}\n${DONE}\n${START}\n[DL] new file`;
    assert.strictEqual(downloadsFinished(logsText('Starting model downloads', dl)), false);
  });
  await test('downloadsFinished: nothing requested -> true', () => {
    assert.strictEqual(downloadsFinished(logsText('Container started\nNo model downloads requested', '')), true);
  });
  await test('downloadsFinished: stale "all done" from an earlier boot, this boot requested none -> true', () => {
    const p = 'Starting model downloads\nContainer started\nNo model downloads requested';
    assert.strictEqual(downloadsFinished(logsText(p, '')), true);
  });
  await test('downloadsFinished: requested but downloads.log not written yet -> false', () => {
    assert.strictEqual(downloadsFinished(logsText('Starting model downloads in the background', '')), false);
  });
  await test('downloadsFinished: no usable logs -> null', () => {
    assert.strictEqual(downloadsFinished(''), null);
    assert.strictEqual(downloadsFinished(null), null);
    assert.strictEqual(downloadsFinished('some unrelated text'), null);
  });

  // ---- ready mode ----------------------------------------------------------
  await test('ready: opens ComfyUI once it is reachable', async () => {
    const h = harness({ probe: [{ reachable: false }, { reachable: false }, { reachable: true }, { reachable: true }] });
    assert.strictEqual(h.opener.watch('abcd1234ef'), true);
    await settle(h);
    assert.deepStrictEqual(h.opened, ['https://abcd1234ef-8188.proxy.runpod.net/']);
    assert.strictEqual(h.events.filter((e) => e.type === 'opened').length, 1);
  });

  await test('ready: needs 2 consecutive answers — a single blip does not open', async () => {
    // reachable, then NOT, then reachable x2: must not open on the first blip
    const h = harness({ probe: [{ reachable: true }, { reachable: false }, { reachable: true }, { reachable: true }] });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.strictEqual(h.calls.probe, 4, 'should have probed 4 times (blip resets the count)');
  });

  await test('ready: waits while the pod is not RUNNING yet', async () => {
    const h = harness({ pod: [{ desiredStatus: 'CREATED' }, { desiredStatus: 'CREATED' }, { desiredStatus: 'RUNNING' }] });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.ok(h.calls.getPod >= 4);
  });

  await test('ready: only ever opens ONCE, even if watch() is called repeatedly', async () => {
    const h = harness();
    assert.strictEqual(h.opener.watch('abcd1234ef'), true);
    assert.strictEqual(h.opener.watch('abcd1234ef'), false);
    assert.strictEqual(h.opener.watch('abcd1234ef'), false);
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
  });

  await test('ready: watches different pods independently', async () => {
    const h = harness();
    h.opener.watch('podaaaa111');
    h.opener.watch('podbbbb222');
    await settle(h);
    assert.deepStrictEqual(h.opened.sort(), [
      'https://podaaaa111-8188.proxy.runpod.net/',
      'https://podbbbb222-8188.proxy.runpod.net/',
    ]);
  });

  // ---- off / switching -----------------------------------------------------
  await test('off: never opens and makes no API calls', async () => {
    const h = harness({ mode: 'off' });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.strictEqual(h.calls.getPod, 0);
    assert.strictEqual(h.calls.probe, 0);
  });

  await test('switching OFF mid-wait stops it from opening', async () => {
    const h = harness({
      probe: (id) => {
        h.mode = 'off'; // user switches it off while we are waiting
        return { reachable: false };
      },
    });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
  });

  await test('switching back ON resumes watching', async () => {
    const h = harness({ mode: 'off' });
    // Deterministic: the user switches it back on after three idle ticks.
    h.onSleep = (n) => {
      if (n === 3) h.mode = 'ready';
    };
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.ok(h.calls.getPod > 0, 'resumed making API calls once switched on');
  });

  // ---- stop conditions -----------------------------------------------------
  await test('stops (does not open) when the pod exits', async () => {
    const h = harness({ pod: { desiredStatus: 'EXITED' } });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.ok(h.events.some((e) => e.type === 'stopped'));
  });

  await test('stops when the pod no longer exists (404)', async () => {
    const h = harness({ pod: new Error('RunPod API error 404 Not Found') });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.strictEqual(h.calls.getPod, 1);
  });

  await test('survives transient API errors and still opens', async () => {
    const h = harness({
      pod: [new Error('Network error'), new Error('Network error'), { desiredStatus: 'RUNNING' }],
    });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
  });

  await test('gives up after repeated API errors', async () => {
    const h = harness({ pod: () => new Error('Network error') });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.strictEqual(h.calls.getPod, 12);
  });

  await test('times out when ComfyUI never comes up (no endless watching)', async () => {
    const h = harness({ probe: { reachable: false } });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.ok(h.events.some((e) => e.type === 'timeout'));
    assert.ok(h.t >= 40 * 60 * 1000, 'waited the full ready budget');
  });

  await test('rejects ids that are not RunPod pod ids', () => {
    const h = harness();
    for (const bad of ['', 'a b', '../etc', 'x', null, undefined, 42, 'a'.repeat(80), 'abc.def', 'abc;rm']) {
      assert.strictEqual(h.opener.watch(bad), false, 'accepted: ' + String(bad));
    }
    assert.strictEqual(h.opener.size(), 0);
  });

  await test('cancel() stops a watcher before it opens', async () => {
    const h = harness({ probe: { reachable: false } });
    h.opener.watch('abcd1234ef');
    assert.strictEqual(h.opener.cancel('abcd1234ef'), true);
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
  });

  // ---- downloads mode ------------------------------------------------------
  await test('downloads: waits for downloads, THEN opens', async () => {
    const running = logsText('Starting model downloads', START + '\n[DL] big file');
    const done = logsText('Starting model downloads', START + '\n' + DONE);
    const h = harness({ mode: 'downloads', logs: [running, running, running, done] });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.strictEqual(h.calls.logs, 4, 'checked the logs until downloads finished');
    assert.strictEqual(h.events.filter((e) => e.type === 'waiting-downloads').length, 1, 'announced the wait once');
    const waitIdx = h.events.findIndex((e) => e.type === 'waiting-downloads');
    const openIdx = h.events.findIndex((e) => e.type === 'opened');
    assert.ok(waitIdx < openIdx);
  });

  await test('downloads: opens straight away when nothing was requested', async () => {
    const h = harness({ mode: 'downloads', logs: logsText('No model downloads requested', '') });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.strictEqual(h.events.filter((e) => e.type === 'waiting-downloads').length, 0);
  });

  await test('downloads: does not open while ComfyUI is up but downloads still run', async () => {
    const running = logsText('Starting model downloads', START);
    const h = harness({ mode: 'downloads', logs: running, probe: { reachable: true } });
    // stop it after a while by exhausting the budget
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 0);
    assert.ok(h.events.some((e) => e.type === 'timeout'));
  });

  await test('downloads: unreadable logs (older image) -> opens anyway, does not wait forever', async () => {
    const h = harness({ mode: 'downloads', logs: new Error('LOG_SERVER_UNREACHABLE') });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
    assert.strictEqual(h.calls.logs, 3, 'tried 3 times before falling back');
  });

  await test('downloads: a failed download still counts as finished (All done is logged)', async () => {
    const dl = START + '\n[ERROR] Failed to download x\n' + DONE;
    const h = harness({ mode: 'downloads', logs: logsText('Starting model downloads', dl) });
    h.opener.watch('abcd1234ef');
    await settle(h);
    assert.strictEqual(h.opened.length, 1);
  });

  await test('open failure is reported, not thrown', async () => {
    const h = harness();
    // replace opener with one whose open() throws
    const o = createAutoOpener({
      getMode: () => 'ready',
      getPod: async () => ({ desiredStatus: 'RUNNING' }),
      probeComfy: async () => ({ reachable: true }),
      fetchPodLogs: async () => '',
      open: async () => {
        throw new Error('no browser');
      },
      notify: (e) => h.events.push(e),
      log: { info() {}, ok() {}, error() {} },
      sleep: async () => new Promise((r) => setImmediate(r)),
    });
    o.watch('abcd1234ef');
    for (let i = 0; i < 200 && o.size() > 0; i++) await new Promise((r) => setImmediate(r));
    assert.ok(h.events.some((e) => e.type === 'open-failed'));
    assert.strictEqual(o.size(), 0);
  });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${results.length - passed} failed`);
})();
