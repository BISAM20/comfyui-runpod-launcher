// =============================================================================
// Renderer logic. Talks to the main process only through window.api (preload).
// =============================================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  gpus: [],
  selectedGpu: null,
  cloudType: 'SECURE',
  pods: [],
  refreshTimer: null,
  pendingConfirm: null,
  progress: null, // { id, timer } for the open progress panel
};

// -----------------------------------------------------------------------------
// Small UI helpers
// -----------------------------------------------------------------------------
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + kind;
  setTimeout(() => el.classList.add('hidden'), 3200);
}

function showScreen(id) {
  $('#screen-setup').classList.add('hidden');
  $('#screen-main').classList.add('hidden');
  $(id).classList.remove('hidden');
}

function showTab(name) {
  if (name !== 'pods') stopProgressPoll(); // leaving Pods → stop tailing
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.remove('active'));
  $('#tab-' + name).classList.add('active');
  if (name === 'pods') loadPods();
  if (name === 'logs') loadLogs();
}

function confirmModal(title, body, confirmLabel, onConfirm) {
  $('#modalTitle').textContent = title;
  $('#modalBody').textContent = body;
  $('#modalConfirm').textContent = confirmLabel || 'Confirm';
  state.pendingConfirm = onConfirm;
  $('#modal').classList.remove('hidden');
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
async function boot() {
  wireEvents();
  renderModelList();
  window.api.onLog(appendLiveLog); // stream logs into the Logs panel

  // Show the "cleaning up pods" overlay when the kill switch fires on close.
  window.api.onClosing((action) => {
    $('#closingTitle').textContent =
      action === 'terminate'
        ? 'Terminating pods…'
        : action === 'stop'
        ? 'Stopping pods…'
        : 'Closing…';
    $('#closingBody').textContent =
      'Cleaning up your running RunPod pods before exit. This closes automatically.';
    $('#closingOverlay').classList.remove('hidden');
  });
  const res = await window.api.hasApiKey();
  if (res.ok && res.data) {
    showScreen('#screen-main');
    await afterLogin();
  } else {
    showScreen('#screen-setup');
  }
}

async function afterLogin() {
  const defaults = await window.api.getDeployDefaults();
  if (defaults.ok) {
    $('#imageName').value = defaults.data.image || '';
    if (defaults.data.containerDisk) $('#containerDisk').value = defaults.data.containerDisk;
    if (defaults.data.volumeDisk) $('#volumeDisk').value = defaults.data.volumeDisk;
    $('#onCloseSelect').value = defaults.data.onClose || 'nothing';
    updateKillSwitchUI();
  }
  loadGpus();
  updateSummary();
}

// Reflect the kill-switch setting in the hint + the sidebar "armed" badge.
function updateKillSwitchUI() {
  const val = $('#onCloseSelect').value;
  const hint = $('#onCloseHint');
  const ind = $('#killIndicator');
  if (val === 'terminate') {
    hint.textContent =
      '⚠ On close, running pods are TERMINATED — pod and downloaded models are deleted.';
    hint.style.color = 'var(--danger)';
    ind.textContent = '🔴 Kill switch: terminate on close';
    ind.className = 'kill-indicator terminate';
  } else if (val === 'stop') {
    hint.textContent =
      'On close, running pods are stopped (billing pauses, models kept).';
    hint.style.color = 'var(--muted)';
    ind.textContent = '🟠 Kill switch: stop on close';
    ind.className = 'kill-indicator stop';
  } else {
    hint.textContent = 'Pods keep running after you close the app.';
    hint.style.color = 'var(--muted)';
    ind.className = 'kill-indicator hidden';
  }
}

// -----------------------------------------------------------------------------
// API key setup
// -----------------------------------------------------------------------------
async function saveKey() {
  const key = $('#apiKeyInput').value.trim();
  const errEl = $('#setupError');
  errEl.classList.add('hidden');
  if (!key) {
    errEl.textContent = 'Please paste your API key.';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = $('#saveKeyBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const res = await window.api.validateAndSaveKey(key);
  btn.disabled = false;
  btn.textContent = 'Save & Continue';
  if (res.ok) {
    $('#apiKeyInput').value = '';
    showScreen('#screen-main');
    await afterLogin();
    toast('API key saved', 'ok');
  } else {
    errEl.textContent = res.error || 'That key did not work. Double-check and try again.';
    errEl.classList.remove('hidden');
  }
}

// -----------------------------------------------------------------------------
// GPU list
// -----------------------------------------------------------------------------
async function loadGpus() {
  const container = $('#gpuList');
  container.innerHTML = '<div class="loading">Loading GPUs…</div>';
  const res = await window.api.gpuTypes();
  if (!res.ok) {
    container.innerHTML = `<div class="empty">Could not load GPUs: ${escapeHtml(
      res.error
    )}</div>`;
    return;
  }
  state.gpus = res.data;
  renderGpus();
}

const STOCK_LABEL = { high: 'High', medium: 'Medium', low: 'Low', unknown: '—' };

// GPUs to always pin to the top, in this order. Each entry is the set of
// whole-word tokens that must all appear in the GPU's display name.
const PINNED = [
  ['rtx', '6000', 'pro'], // RTX PRO 6000
  ['a40'], // A40
  ['rtx', '4500', 'pro'], // RTX PRO 4500
];

function pinRank(name) {
  const words = String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let i = 0; i < PINNED.length; i++) {
    if (PINNED[i].every((tok) => words.includes(tok))) return i;
  }
  return Infinity;
}

// The availability object for a GPU in the currently selected cloud.
function availFor(g) {
  return state.cloudType === 'SECURE' ? g.secure : g.community;
}

function renderGpus() {
  const container = $('#gpuList');
  const wantSecure = state.cloudType === 'SECURE';

  // Only GPUs that are actually available in the selected cloud right now.
  const list = state.gpus
    .map((g) => ({ g, avail: availFor(g) }))
    .filter((x) => x.avail)
    // Pinned favourites first (in PINNED order), then available-highest, then
    // cheapest.
    .sort((a, b) => {
      const pa = pinRank(a.g.displayName);
      const pb = pinRank(b.g.displayName);
      if (pa !== pb) return pa - pb;
      const rank = { high: 0, medium: 1, low: 2, unknown: 3 };
      const d = rank[a.avail.stock] - rank[b.avail.stock];
      return d !== 0 ? d : a.avail.price - b.avail.price;
    });

  if (!list.length) {
    container.innerHTML =
      '<div class="empty">No GPUs available in this cloud right now. Try Community, or refresh.</div>';
    return;
  }

  container.innerHTML = '';
  for (const { g, avail } of list) {
    const card = document.createElement('div');
    card.className = 'gpu-card' + (state.selectedGpu === g.id ? ' selected' : '');
    card.dataset.id = g.id;
    const cloudChip = wantSecure
      ? '<span class="chip secure">Secure</span>'
      : '<span class="chip community">Community</span>';
    const star = pinRank(g.displayName) !== Infinity ? '<span class="pin">★</span>' : '';
    card.innerHTML = `
      <div class="gpu-name">${star}${escapeHtml(g.displayName)} ${cloudChip}</div>
      <div class="gpu-meta">${g.memoryInGb} GB VRAM · ${escapeHtml(
        g.manufacturer || ''
      )}</div>
      <div class="gpu-bottom">
        <span class="gpu-price">$${avail.price.toFixed(2)}<span>/hr</span></span>
        <span class="avail ${avail.stock}">
          <span class="dot"></span>${STOCK_LABEL[avail.stock]}
        </span>
      </div>
    `;
    card.addEventListener('click', () => {
      state.selectedGpu = g.id;
      renderGpus();
      updateSummary();
      validateDeploy();
    });
    container.appendChild(card);
  }
}

// -----------------------------------------------------------------------------
// Model list
// -----------------------------------------------------------------------------
function renderModelList() {
  const container = $('#modelList');
  container.innerHTML = '';
  for (const m of window.MODEL_CATALOG) {
    const row = document.createElement('label');
    row.className = 'model-row';
    row.innerHTML = `
      <input type="checkbox" data-env="${m.env}" data-gb="${m.gb}" ${
      m.needsHfToken ? 'data-hf="1"' : ''
    } />
      <div>
        <div class="m-name">${escapeHtml(m.name)}</div>
        <div class="m-desc">${escapeHtml(m.desc)}</div>
      </div>
      <div class="m-size">+${m.gb} GB</div>
    `;
    row.querySelector('input').addEventListener('change', updateSummary);
    container.appendChild(row);
  }
}

function selectedModels() {
  return $$('#modelList input:checked').map((i) => ({
    env: i.dataset.env,
    gb: parseFloat(i.dataset.gb),
    hf: i.dataset.hf === '1',
  }));
}

// -----------------------------------------------------------------------------
// Cost / disk summary
// -----------------------------------------------------------------------------
function updateSummary() {
  const gpu = state.gpus.find((g) => g.id === state.selectedGpu);
  const avail = gpu ? availFor(gpu) : null;
  $('#summaryRate').textContent = avail ? `$${avail.price.toFixed(2)}/hr` : '—';

  const models = selectedModels();
  const modelGb = models.reduce((s, m) => s + m.gb, 0);
  const needed = Math.ceil(modelGb + 8); // + shared encoders/vae/clip headroom
  $('#summaryDisk').textContent = modelGb ? `~${needed} GB` : 'bare';

  // Warn if volume disk looks too small for the selected models.
  const vol = parseInt($('#volumeDisk').value, 10) || 0;
  const hint = $('#volumeHint');
  if (modelGb && vol < needed) {
    hint.textContent = `⚠ Selected models need ~${needed} GB — increase volume disk.`;
    hint.style.color = 'var(--amber)';
  } else {
    hint.textContent = '';
  }

  // Warn if container disk is set high — the #1 cause of "machine does not
  // have the resources" placement failures.
  const cont = parseInt($('#containerDisk').value, 10) || 0;
  const cHint = $('#containerHint');
  if (cont > 120) {
    cHint.textContent =
      '⚠ Very high — many machines can’t place this. 30–50 GB is recommended.';
    cHint.style.color = 'var(--danger)';
  } else if (cont > 80) {
    cHint.textContent = '⚠ Higher than needed — 30–50 GB is plenty.';
    cHint.style.color = 'var(--amber)';
  } else {
    cHint.textContent = '';
  }

  // Reveal HF token field only when a model needs it.
  const needsHf = models.some((m) => m.hf);
  $('#hfTokenField').classList.toggle('hidden', !needsHf);
}

// -----------------------------------------------------------------------------
// Deploy
// -----------------------------------------------------------------------------
function validateDeploy() {
  $('#deployBtn').disabled = !state.selectedGpu;
}

async function deploy() {
  if (!state.selectedGpu) return;

  const env = {};
  // All flags default to false in the image; only set the ones we want on.
  for (const m of window.MODEL_CATALOG) env[m.env] = 'false';
  const models = selectedModels();
  for (const m of models) env[m.env] = 'true';

  const hfToken = $('#hfToken').value.trim();
  if (hfToken) env.HF_TOKEN = hfToken;

  const opts = {
    name: $('#podName').value.trim() || 'comfyui-pod',
    gpuTypeId: state.selectedGpu,
    gpuCount: 1,
    cloudType: state.cloudType,
    containerDiskInGb: parseInt($('#containerDisk').value, 10) || 30,
    volumeInGb: parseInt($('#volumeDisk').value, 10) || 100,
    env,
    imageName: $('#imageName').value.trim() || undefined,
  };

  const btn = $('#deployBtn');
  btn.disabled = true;
  btn.textContent = 'Deploying…';
  const msg = $('#deployMsg');
  msg.className = 'msg hidden';

  const res = await window.api.createPod(opts);

  btn.textContent = '🚀 Deploy Pod';
  btn.disabled = false;

  if (res.ok) {
    // Remember disk preferences for next time.
    window.api.saveDeployDefaults({
      image: opts.imageName,
      containerDisk: opts.containerDiskInGb,
      volumeDisk: opts.volumeInGb,
    });
    msg.className = 'msg success';
    msg.textContent =
      '✓ Pod created! It is booting now — open the My Pods tab to get your ComfyUI link.';
    toast('Pod deployed', 'ok');
    setTimeout(() => showTab('pods'), 900);
  } else {
    msg.className = 'msg err';
    msg.textContent = '✗ ' + (res.error || 'Deploy failed.');
  }
}

// -----------------------------------------------------------------------------
// Pods list
// -----------------------------------------------------------------------------
async function loadPods() {
  stopProgressPoll(); // re-render replaces panels; drop any dangling poll
  const container = $('#podsList');
  if (!state.pods.length) container.innerHTML = '<div class="loading">Loading pods…</div>';
  const res = await window.api.listPods();
  if (!res.ok) {
    container.innerHTML = `<div class="empty">Could not load pods: ${escapeHtml(
      res.error
    )}</div>`;
    return;
  }
  state.pods = res.data;
  renderPods();
  scheduleRefresh();
}

function statusClass(s) {
  const v = (s || '').toUpperCase();
  if (v === 'RUNNING') return 'running';
  if (v === 'EXITED' || v === 'STOPPED') return 'exited';
  return 'other';
}

function renderPods() {
  const container = $('#podsList');
  const badge = $('#podCount');
  badge.textContent = state.pods.length;
  badge.classList.toggle('hidden', state.pods.length === 0);

  if (!state.pods.length) {
    container.innerHTML =
      '<div class="empty">No pods yet. Deploy one from the Deploy tab.</div>';
    return;
  }

  container.innerHTML = '';
  for (const p of state.pods) {
    const status = p.desiredStatus || 'UNKNOWN';
    const running = (status || '').toUpperCase() === 'RUNNING';
    const gpuName =
      (p.gpu && (p.gpu.displayName || p.gpu.id)) ||
      (p.machine && p.machine.gpuDisplayName) ||
      '';
    const cost = p.costPerHr != null ? `$${Number(p.costPerHr).toFixed(2)}/hr` : '';

    const card = document.createElement('div');
    card.className = 'pod-card';
    card.innerHTML = `
      <div class="pod-top">
        <div>
          <div class="pod-name">${escapeHtml(p.name || p.id)}</div>
          <div class="pod-sub">${escapeHtml(gpuName)} ${
      gpuName && cost ? '·' : ''
    } ${cost} · ${escapeHtml(p.id)}</div>
        </div>
        <span class="status ${statusClass(status)}">${escapeHtml(status)}</span>
      </div>
      <div class="pod-links">
        <a data-url="${p.comfyUrl}" class="${running ? '' : 'disabled'}">🎨 Open ComfyUI</a>
        <a data-url="${p.jupyterUrl}" class="${running ? '' : 'disabled'}">📓 JupyterLab</a>
      </div>
      <div class="pod-actions">
        <button class="btn ghost" data-act="progress" data-id="${p.id}">📋 Progress / Logs</button>
        ${
          running
            ? `<button class="btn ghost" data-act="stop" data-id="${p.id}">⏸ Stop</button>`
            : `<button class="btn ghost" data-act="start" data-id="${p.id}">▶ Start</button>`
        }
        <button class="btn danger" data-act="terminate" data-id="${p.id}" data-name="${escapeHtml(
      p.name || p.id
    )}">🗑 Terminate</button>
      </div>
      <div class="pod-progress hidden" id="prog-${p.id}"></div>
    `;
    container.appendChild(card);
  }

  // Wire link + action handlers
  $$('#podsList a[data-url]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (!a.classList.contains('disabled')) window.api.openExternal(a.dataset.url);
    })
  );
  $$('#podsList button[data-act]').forEach((b) =>
    b.addEventListener('click', () => podAction(b.dataset.act, b.dataset.id, b.dataset.name))
  );
}

// -----------------------------------------------------------------------------
// Per-pod live progress panel (status timeline + ComfyUI readiness + logs)
// -----------------------------------------------------------------------------
function stopProgressPoll() {
  if (state.progress && state.progress.timer) clearInterval(state.progress.timer);
  state.progress = null;
}

function toggleProgress(id) {
  const panel = document.getElementById('prog-' + id);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  stopProgressPoll();
  // Collapse any other open panel.
  $$('.pod-progress').forEach((p) => p.classList.add('hidden'));
  if (isOpen) return; // was open → now closed

  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="loading">Fetching progress…</div>';
  pollProgress(id);
  state.progress = { id, timer: setInterval(() => pollProgress(id), 5000) };
}

async function pollProgress(id) {
  const panel = document.getElementById('prog-' + id);
  if (!panel || panel.classList.contains('hidden')) return;
  const res = await window.api.podProgress(id);
  const p = document.getElementById('prog-' + id);
  if (!p || p.classList.contains('hidden')) return;
  if (!res.ok) {
    p.innerHTML = `<div class="empty">${escapeHtml(res.error || 'Failed to load')}</div>`;
    return;
  }
  renderProgress(p, res.data);
}

function progressSteps(d) {
  const running = (d.status || '').toUpperCase() === 'RUNNING';
  const comfy = d.comfyReachable;
  return [
    { label: 'Pod created', state: 'done' },
    {
      label: running ? 'Machine running' : 'Pulling image / starting…',
      state: running ? 'done' : 'active',
    },
    {
      label: comfy ? 'ComfyUI is ready' : 'ComfyUI starting…',
      state: comfy ? 'done' : running ? 'active' : 'pending',
    },
  ];
}

function renderProgress(panel, d) {
  const timeline = progressSteps(d)
    .map(
      (s) =>
        `<div class="pstep ${s.state}"><span class="pdot"></span>${escapeHtml(
          s.label
        )}</div>`
    )
    .join('');

  let logHtml;
  if (d.logs) {
    logHtml = `<pre class="pod-log">${escapeHtml(d.logs)}</pre>`;
  } else if (d.logError === 'LOG_SERVER_UNREACHABLE') {
    logHtml = `<div class="pod-log-note">
      Container logs aren't streaming for this pod yet. They appear here live once
      the pod is <b>running</b> and was started from the <b>rebuilt image</b>
      (which includes the log server on port 8189). For a pod on the old image,
      use the <b>RunPod Console</b> link in the sidebar.
    </div>`;
  } else {
    logHtml = `<div class="pod-log-note">${escapeHtml(d.logError || '')}</div>`;
  }

  panel.innerHTML = `<div class="ptimeline">${timeline}</div>${logHtml}`;
  const pre = panel.querySelector('.pod-log');
  if (pre) pre.scrollTop = pre.scrollHeight;
}

async function podAction(act, id, name) {
  if (act === 'progress') {
    toggleProgress(id);
    return;
  }
  if (act === 'terminate') {
    confirmModal(
      'Terminate pod?',
      `This permanently deletes "${name}" and its volume disk. Downloaded models will be lost. This cannot be undone.`,
      'Terminate',
      async () => {
        const res = await window.api.deletePod(id);
        if (res.ok) {
          toast('Pod terminated', 'ok');
          state.pods = state.pods.filter((p) => p.id !== id);
          renderPods();
        } else toast(res.error || 'Failed to terminate', 'err');
      }
    );
    return;
  }

  const fn = act === 'stop' ? window.api.stopPod : window.api.startPod;
  toast(act === 'stop' ? 'Stopping…' : 'Starting…');
  const res = await fn(id);
  if (res.ok) {
    toast(act === 'stop' ? 'Pod stopped' : 'Pod starting', 'ok');
    setTimeout(loadPods, 1200);
  } else {
    toast(res.error || 'Action failed', 'err');
  }
}

// Auto-refresh pods every 12s while on the Pods tab — but pause it while a
// progress panel is open (a re-render would close the panel mid-tail).
function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    if ($('#tab-pods').classList.contains('active') && !state.progress) loadPods();
    else scheduleRefresh();
  }, 12000);
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------
function wireEvents() {
  $('#saveKeyBtn').addEventListener('click', saveKey);
  $('#apiKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKey();
  });
  $('#getKeyLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://console.runpod.io/user/settings');
  });
  $('#openConsoleLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://console.runpod.io/pods');
  });

  $$('.nav-item').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab))
  );

  // Cloud type segmented control
  $$('#cloudType button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#cloudType button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.cloudType = b.dataset.value;
      state.selectedGpu = null;
      renderGpus();
      updateSummary();
      validateDeploy();
    })
  );

  $('#refreshGpuBtn').addEventListener('click', loadGpus);
  $('#refreshPodsBtn').addEventListener('click', loadPods);
  $('#deployBtn').addEventListener('click', deploy);
  $('#volumeDisk').addEventListener('input', updateSummary);
  $('#containerDisk').addEventListener('input', updateSummary);

  // Settings
  $('#saveSettingsBtn').addEventListener('click', async () => {
    await window.api.saveDeployDefaults({
      image: $('#imageName').value.trim(),
      containerDisk: parseInt($('#containerDisk').value, 10) || 30,
      volumeDisk: parseInt($('#volumeDisk').value, 10) || 100,
    });
    const msg = $('#settingsMsg');
    msg.className = 'msg success';
    msg.textContent = '✓ Settings saved.';
    setTimeout(() => msg.classList.add('hidden'), 2500);
  });
  $('#changeKeyBtn').addEventListener('click', async () => {
    await window.api.clearApiKey();
    showScreen('#screen-setup');
  });

  // Kill switch selector — save immediately on change.
  $('#onCloseSelect').addEventListener('change', async () => {
    const val = $('#onCloseSelect').value;
    await window.api.setOnClose(val);
    updateKillSwitchUI();
    toast('Kill switch set to: ' + val, 'ok');
  });

  // Logs
  $('#clearLogsBtn').addEventListener('click', async () => {
    await window.api.clearLogs();
    $('#logView').innerHTML = '<div class="empty">No activity yet.</div>';
  });
  $('#copyLogsBtn').addEventListener('click', async () => {
    const res = await window.api.getLogs();
    const entries = (res.ok && res.data) || [];
    const text = entries
      .map(
        (e) =>
          `${fmtTime(e.t)} [${e.level}] ${e.msg}` +
          (e.detail ? `\n    ${e.detail}` : '')
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Logs copied', 'ok');
    } catch {
      toast('Could not copy', 'err');
    }
  });

  // Modal
  $('#modalCancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
  $('#modalConfirm').addEventListener('click', () => {
    $('#modal').classList.add('hidden');
    if (state.pendingConfirm) state.pendingConfirm();
    state.pendingConfirm = null;
  });
}

// -----------------------------------------------------------------------------
// Logs panel
// -----------------------------------------------------------------------------
const LV_LABEL = { req: '→ REQ', ok: '✓ OK', info: 'INFO', error: '✕ ERR' };

function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmtTime(t) {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function logLineEl(entry) {
  const wrap = document.createElement('div');
  const line = document.createElement('div');
  line.className = 'log-line ' + entry.level;
  line.innerHTML = `
    <span class="ts">${fmtTime(entry.t)}</span>
    <span class="lv">${LV_LABEL[entry.level] || entry.level}</span>
    <span class="txt">${escapeHtml(entry.msg)}</span>
  `;
  wrap.appendChild(line);
  if (entry.detail) {
    let pretty = entry.detail;
    try {
      pretty = JSON.stringify(JSON.parse(entry.detail), null, 2);
    } catch {
      /* leave as-is */
    }
    const det = document.createElement('div');
    det.className = 'log-detail';
    det.textContent = pretty;
    wrap.appendChild(det);
  }
  return wrap;
}

function maybeScroll() {
  if ($('#autoscrollLogs').checked) {
    const v = $('#logView');
    v.scrollTop = v.scrollHeight;
  }
}

async function loadLogs() {
  const res = await window.api.getLogs();
  const view = $('#logView');
  view.innerHTML = '';
  const entries = (res.ok && res.data) || [];
  if (!entries.length) {
    view.innerHTML = '<div class="empty">No activity yet.</div>';
    return;
  }
  for (const e of entries) view.appendChild(logLineEl(e));
  maybeScroll();
}

function appendLiveLog(entry) {
  const view = $('#logView');
  if (!view) return;
  // Clear the "No activity yet" placeholder.
  const empty = view.querySelector('.empty');
  if (empty) view.innerHTML = '';
  view.appendChild(logLineEl(entry));
  // Cap the DOM size.
  while (view.childElementCount > 800) view.removeChild(view.firstChild);
  if ($('#tab-logs').classList.contains('active')) maybeScroll();
}

// -----------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

boot();
