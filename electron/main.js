// =============================================================================
// Electron main process — creates the window and bridges the UI to RunPod.
// All network calls to RunPod happen here (main process = no CORS problems).
// =============================================================================

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const runpod = require('./runpod');
const store = require('./store');
const log = require('./logger');
const { createAutoOpener } = require('./autoopen');

// The ONE Docker image this launcher deploys. It is fixed: the renderer cannot
// choose a different one, and an image saved by an older version is ignored.
const DEFAULT_IMAGE = 'bishoy22/comfyui-studio:latest';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    title: 'ComfyUI RunPod Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // ---------------------------------------------------------------------------
  // Kill switch — when the window is closed, optionally stop/terminate any
  // running pods first so nothing is left billing. Controlled by the "onClose"
  // setting: 'nothing' | 'stop' | 'terminate'.
  // ---------------------------------------------------------------------------
  mainWindow.on('close', (e) => {
    if (isClosing) return; // second pass — let it close
    const settings = store.loadSettings();
    const action = settings.onClose || 'nothing';
    if (action === 'nothing' || !store.getApiKey()) return; // normal close

    e.preventDefault();
    isClosing = true;
    // Show the "terminating…" overlay in the UI.
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:closing', action);
    }
    const work = runCloseAction(action).catch((err) =>
      log.error('Kill switch failed: ' + (err && err.message ? err.message : err))
    );
    const timeout = new Promise((r) => setTimeout(r, 20000)); // never hang forever
    Promise.race([work, timeout]).finally(() => {
      if (!mainWindow.isDestroyed()) mainWindow.destroy();
    });
  });
}

let isClosing = false;

// Stop or terminate every currently-running pod. Used by the kill switch.
async function runCloseAction(action) {
  const key = store.getApiKey();
  if (!key) return;
  const pods = await runpod.listPods(key);
  const running = pods.filter(
    (p) => (p.desiredStatus || '').toUpperCase() === 'RUNNING'
  );
  if (!running.length) {
    log.info('Kill switch: no running pods to ' + action);
    return;
  }
  log.info(`Kill switch: ${action} ${running.length} running pod(s) on close`);
  const fn = action === 'terminate' ? runpod.deletePod : runpod.stopPod;
  await Promise.allSettled(running.map((p) => fn(key, p.id)));
  log.ok(`Kill switch: ${action} complete`);
}

// Forward every log entry to the renderer's Logs panel.
log.bus.on('log', (entry) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log:entry', entry);
  }
});

app.whenReady().then(() => {
  // The image used to be a saved, editable setting. It is fixed now, so drop any
  // old value — otherwise an upgrade from 1.4.0 or earlier would keep pointing
  // at the retired comfyui-wan image.
  const saved = store.loadSettings();
  if ('image' in saved) {
    delete saved.image;
    store.saveSettings(saved);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -----------------------------------------------------------------------------
// Helper: get the stored key or throw a friendly error.
// -----------------------------------------------------------------------------
function requireKey() {
  const key = store.getApiKey();
  if (!key) throw new Error('No API key saved. Add your RunPod API key first.');
  return key;
}

// -----------------------------------------------------------------------------
// Auto-open: once a pod created/started from this app is ready, open ComfyUI in
// the user's default browser. Setting `autoOpen`: 'off' | 'ready' | 'downloads'.
// -----------------------------------------------------------------------------
const AUTO_OPEN_MODES = ['off', 'ready', 'downloads'];

const autoOpener = createAutoOpener({
  getMode: () => {
    const m = store.loadSettings().autoOpen;
    return AUTO_OPEN_MODES.includes(m) ? m : 'ready'; // on by default
  },
  getPod: (id) => runpod.getPod(requireKey(), id),
  probeComfy: (id) => runpod.probeComfy(id),
  fetchPodLogs: (id) => runpod.fetchPodLogs(id),
  open: (url) => shell.openExternal(url),
  notify: (evt) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pod:autoOpen', evt);
    }
  },
  log,
});

// Wrap an async handler so errors come back as { ok, error } instead of crashing.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_evt, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, data: result };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      log.error(`${channel} failed: ${message}`);
      return { ok: false, error: message };
    }
  });
}

// Logs panel channels
ipcMain.handle('logs:get', () => log.buffer);
ipcMain.handle('logs:clear', () => {
  log.buffer.length = 0;
  return true;
});

// -----------------------------------------------------------------------------
// API-key / settings channels
// -----------------------------------------------------------------------------
handle('settings:hasApiKey', async () => store.hasApiKey());

handle('settings:validateAndSave', async (apiKey) => {
  await runpod.validateKey(apiKey); // throws if invalid
  store.saveApiKey(apiKey);
  return true;
});

handle('settings:clearApiKey', async () => {
  store.clearApiKey();
  return true;
});

// Forget EVERYTHING secret saved on this PC: the RunPod key and the HuggingFace
// token. (clearApiKey above, used by "Change key", clears only the RunPod key.)
handle('settings:forgetKeys', async () => {
  autoOpener.cancelAll(); // nothing may keep acting on the account we just forgot
  store.clearApiKey();
  store.clearHfToken();
  log.info('Saved RunPod key and HuggingFace token removed from this PC');
  return { apiKey: store.hasApiKey(), hfToken: store.hasHfToken() };
});

handle('settings:getDeployDefaults', async () => {
  const s = store.loadSettings();
  return { autoOpen: 'ready', ...s, image: DEFAULT_IMAGE }; // image always wins
});

handle('settings:saveDeployDefaults', async (obj) => {
  const s = store.loadSettings();
  const { image: _ignored, ...rest } = obj || {}; // the image is not a setting any more
  store.saveSettings({ ...s, ...rest }); // merge — never drop other settings
  return true;
});

// --- HuggingFace token (encrypted, for gated/private models) ---
handle('settings:hasHfToken', async () => store.hasHfToken());
handle('settings:saveHfToken', async (token) => {
  if (token) store.saveHfToken(token);
  else store.clearHfToken();
  return store.hasHfToken();
});
handle('settings:clearHfToken', async () => {
  store.clearHfToken();
  return true;
});

// --- Account balance / spend rate ---
handle('runpod:balance', async () => runpod.getBalance(requireKey()));

// --- Model catalog, defined by the Docker image rather than the app ---
// Tries, in order: the configured manifest URL, the ComfyUI Studio image's own
// label on Docker Hub, then a running pod (which serves /models.json on its log
// server). If all fail the renderer shows an explanation and no model rows — there
// is deliberately no bundled list that could drift from the image.
handle('runpod:modelManifest', async () => {
  const settings = store.loadSettings();
  const url = (settings.manifestUrl || '').trim();
  const image = DEFAULT_IMAGE; // the catalog of THE image we deploy, nothing else

  // 1. Explicit manifest URL wins.
  if (url) {
    try {
      return await runpod.fetchModelManifest({ url });
    } catch (e) {
      log.error('Manifest URL failed: ' + (e && e.message ? e.message : e));
    }
  }

  // 2. Read the catalog from the image itself on Docker Hub. Works before any
  //    pod exists, and always matches the image that will be deployed.
  if (image) {
    try {
      return await runpod.fetchManifestFromRegistry(image);
    } catch (e) {
      log.error('Image catalog read failed: ' + (e && e.message ? e.message : e));
    }
  }

  // 3. Fall back to a running pod (rich models.json).
  const key = store.getApiKey();
  if (key) {
    try {
      const pods = await runpod.listPods(key);
      const running = pods.find(
        (p) =>
          (p.desiredStatus || '').toUpperCase() === 'RUNNING' &&
          (!image || p.image === image)
      );
      if (running) return await runpod.fetchModelManifest({ podId: running.id });
    } catch (e) {
      log.error('Manifest from pod failed: ' + (e && e.message ? e.message : e));
    }
  }

  throw new Error('No manifest available — using the built-in model list.');
});

handle('settings:setOnClose', async (action) => {
  const valid = ['nothing', 'stop', 'terminate'];
  const s = store.loadSettings();
  s.onClose = valid.includes(action) ? action : 'nothing';
  store.saveSettings(s);
  return s.onClose;
});

handle('settings:setAutoOpen', async (mode) => {
  const s = store.loadSettings();
  s.autoOpen = AUTO_OPEN_MODES.includes(mode) ? mode : 'ready';
  store.saveSettings(s);
  return s.autoOpen;
});

// -----------------------------------------------------------------------------
// RunPod channels
// -----------------------------------------------------------------------------
handle('runpod:gpuTypes', async () => runpod.listGpuTypes(requireKey()));

handle('runpod:createPod', async (opts) => {
  // Always the fixed image — whatever the renderer sent for imageName is ignored.
  const merged = { ...opts, imageName: DEFAULT_IMAGE };
  // Inject the saved HuggingFace token unless the deploy form supplied one.
  // Kept out of the renderer so the token never has to travel through the UI.
  if (!merged.env || !merged.env.HF_TOKEN) {
    const hf = store.getHfToken();
    if (hf) merged.env = { ...(merged.env || {}), HF_TOKEN: hf };
  }
  const pod = await runpod.createPod(requireKey(), merged);
  if (pod && pod.id) autoOpener.watch(pod.id); // open ComfyUI when it is ready
  return pod;
});

handle('runpod:listPods', async () => runpod.listPods(requireKey()));
handle('runpod:getPod', async (id) => runpod.getPod(requireKey(), id));
handle('runpod:stopPod', async (id) => {
  autoOpener.cancel(id);
  return runpod.stopPod(requireKey(), id);
});
handle('runpod:startPod', async (id) => {
  const res = await runpod.startPod(requireKey(), id);
  autoOpener.watch(id); // a resumed pod gets the same treatment
  return res;
});
handle('runpod:deletePod', async (id) => {
  autoOpener.cancel(id);
  return runpod.deletePod(requireKey(), id);
});

// Live progress — status + ComfyUI readiness + in-image container logs.
handle('runpod:podProgress', async (id) => {
  const pod = await runpod.getPod(requireKey(), id);
  const comfy = await runpod.probeComfy(id);
  let logs = null;
  let logError = null;
  try {
    logs = await runpod.fetchPodLogs(id);
  } catch (e) {
    logError = e && e.message ? e.message : String(e);
  }
  return {
    status: pod.desiredStatus,
    lastStatusChange: pod.lastStatusChange,
    comfyReachable: comfy.reachable,
    comfyUrl: pod.comfyUrl,
    logs,
    logError,
  };
});

// -----------------------------------------------------------------------------
// Open external links (ComfyUI, Jupyter, docs) in the default browser.
// -----------------------------------------------------------------------------
handle('app:openExternal', async (url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
  return true;
});
