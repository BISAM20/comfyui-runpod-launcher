// =============================================================================
// Auto-open ComfyUI in the browser once a pod is ready.
//
// After a pod is created (or started) the app watches it in the background and
// opens ComfyUI in the user's default browser the moment it is reachable — so
// there is no need to visit My Pods and click "Open ComfyUI".
//
// Modes (setting `autoOpen`):
//   'off'        never open automatically
//   'ready'      open as soon as ComfyUI answers          (default)
//   'downloads'  also wait for the pod's model downloads to finish first
//
// Everything the watcher touches is injected, so it can be tested without
// Electron or a real RunPod pod (see tools/test-autoopen.js).
// =============================================================================

const POD_ID = /^[a-z0-9]{4,64}$/i;

// -----------------------------------------------------------------------------
// Have the pod's model downloads finished?
//
// Reads the combined log text served by the pod (see fetchPodLogs in runpod.js:
// sections headed "===== <file> ====="). The image writes:
//   progress.log  "Starting model downloads in the background"
//                 or "No model downloads requested"
//   downloads.log "[DOWNLOADS] Starting: ..." ... "[DOWNLOADS] All done: ..."
//
// Returns true (finished / nothing to download), false (still running) or null
// (cannot tell — e.g. an image without these logs).
// -----------------------------------------------------------------------------
function section(text, name) {
  const marker = `===== ${name} =====`;
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const start = i + marker.length;
  const next = text.indexOf('\n===== ', start);
  return text.slice(start, next < 0 ? undefined : next);
}

function downloadsFinished(logText) {
  if (!logText || typeof logText !== 'string') return null;
  const progress = section(logText, 'progress.log') || '';
  const dl = section(logText, 'downloads.log') || '';

  // Judge by the most recent run only: downloads.log can hold an older run.
  const lastStart = dl.lastIndexOf('[DOWNLOADS] Starting');
  const lastDone = dl.lastIndexOf('[DOWNLOADS] All done');
  if (lastStart >= 0) return lastDone > lastStart;

  // No run recorded yet — progress.log says whether one was requested.
  const requested = progress.lastIndexOf('Starting model downloads');
  const none = progress.lastIndexOf('No model downloads requested');
  if (none > requested) return true; // this boot asked for nothing
  if (requested >= 0) return false; // asked for downloads, log not written yet
  return null;
}

// -----------------------------------------------------------------------------
// The watcher
// -----------------------------------------------------------------------------
function createAutoOpener(deps) {
  const cfg = {
    readyIntervalMs: 8000, // how often to check while waiting for ComfyUI
    downloadsIntervalMs: 20000, // …and while waiting for downloads
    readyTimeoutMs: 40 * 60 * 1000, // give up waiting for ComfyUI after 40 min
    downloadsTimeoutMs: 6 * 60 * 60 * 1000, // downloads can be large — 6 h
    requiredProbes: 2, // consecutive "reachable" answers before opening
    unknownLimit: 3, // ticks of "can't tell" before opening anyway
    maxErrors: 12, // consecutive API failures before giving up
    comfyPort: 8188,
    ...(deps.timing || {}),
  };
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || Date.now;
  const log = deps.log || { info() {}, ok() {}, error() {} };
  const notify = deps.notify || (() => {});

  const watchers = new Map(); // podId -> { cancelled }

  const urlFor = (podId) => `https://${podId}-${cfg.comfyPort}.proxy.runpod.net/`;

  async function run(podId, w) {
    const started = now();
    let probes = 0;
    let unknown = 0;
    let errors = 0;
    let announced = false;

    const finish = (why) => {
      watchers.delete(podId);
      log.info(`Auto-open: stopped watching ${podId} (${why})`);
    };

    const openIt = async () => {
      const url = urlFor(podId);
      try {
        await deps.open(url);
        log.ok(`Auto-open: opened ComfyUI for pod ${podId}`);
        notify({ type: 'opened', podId, url });
      } catch (e) {
        log.error('Auto-open: could not open the browser: ' + (e && e.message ? e.message : e));
        notify({ type: 'open-failed', podId, url });
      }
      finish('opened');
    };

    log.info(`Auto-open: watching pod ${podId} until ComfyUI is ready`);

    while (!w.cancelled) {
      const mode = deps.getMode();

      // Switched off? Keep the watcher alive but idle, so switching it back on
      // resumes — and make no API calls while it is off.
      if (mode === 'off') {
        if (now() - started > cfg.readyTimeoutMs) return finish('timed out while off');
        await sleep(cfg.readyIntervalMs);
        continue;
      }

      const budget = mode === 'downloads' ? cfg.downloadsTimeoutMs : cfg.readyTimeoutMs;
      if (now() - started > budget) {
        notify({ type: 'timeout', podId });
        return finish('timed out');
      }

      let wait = cfg.readyIntervalMs;
      try {
        const pod = await deps.getPod(podId);
        errors = 0;
        const status = String((pod && pod.desiredStatus) || '').toUpperCase();

        if (status === 'EXITED' || status === 'TERMINATED') {
          notify({ type: 'stopped', podId });
          return finish('pod is ' + status.toLowerCase());
        }

        if (status === 'RUNNING') {
          const probe = await deps.probeComfy(podId);
          probes = probe && probe.reachable ? probes + 1 : 0;

          if (probes >= cfg.requiredProbes) {
            if (mode === 'ready') return openIt();

            // mode === 'downloads': ComfyUI is up, now wait for the downloads.
            let finished = null;
            try {
              finished = downloadsFinished(await deps.fetchPodLogs(podId));
            } catch {
              finished = null;
            }

            if (finished === true) return openIt();

            if (finished === null) {
              // Image without readable download logs: do not wait forever.
              unknown += 1;
              if (unknown >= cfg.unknownLimit) {
                log.info('Auto-open: download status unavailable, opening anyway');
                return openIt();
              }
            } else {
              unknown = 0;
            }

            if (!announced) {
              announced = true;
              notify({ type: 'waiting-downloads', podId });
            }
            wait = cfg.downloadsIntervalMs;
          }
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (/404|not found/i.test(msg)) return finish('pod no longer exists');
        errors += 1;
        if (errors >= cfg.maxErrors) {
          log.error('Auto-open: giving up after repeated errors: ' + msg);
          return finish('repeated errors');
        }
      }

      await sleep(wait);
    }
    finish('cancelled');
  }

  return {
    // Start watching a pod. Returns false if it is already being watched or the
    // id does not look like a RunPod pod id.
    watch(podId) {
      if (typeof podId !== 'string' || !POD_ID.test(podId)) return false;
      if (watchers.has(podId)) return false;
      const w = { cancelled: false };
      watchers.set(podId, w);
      run(podId, w).catch((e) => {
        watchers.delete(podId);
        log.error('Auto-open watcher crashed: ' + (e && e.message ? e.message : e));
      });
      return true;
    },
    cancel(podId) {
      const w = watchers.get(podId);
      if (w) w.cancelled = true;
      return !!w;
    },
    cancelAll() {
      for (const w of watchers.values()) w.cancelled = true;
    },
    isWatching: (podId) => watchers.has(podId),
    size: () => watchers.size,
    urlFor,
  };
}

module.exports = { createAutoOpener, downloadsFinished, POD_ID };
