// Generates README screenshots by loading the real renderer with mock data.
// Run:  npx electron tools/screenshot.js
//
// If the studio image source is checked out next to this repo
// (../Runpod_docker/LTX_Krea/models.json) its real catalog is loaded, so the
// screenshots show the actual model packs and LoRA file names. Without it the
// mock preload's smaller Wan list is used.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const STUDIO_IMAGE = 'bishoy22/comfyui-studio:latest';
const STUDIO_MANIFEST = path.join(
  __dirname, '..', '..', 'Runpod_docker', 'LTX_Krea', 'models.json'
);

const W = 1160;
const H = 800;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, name, rect) {
  await wait(700);
  win.webContents.invalidate(); // force a fresh frame — avoids a stale capture after a resize
  await wait(300);
  const img = rect
    ? await win.webContents.capturePage(rect)
    : await win.webContents.capturePage();
  const buf = img.toPNG();
  if (!buf || !buf.length) throw new Error('empty capture for ' + name);
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  console.log('saved', name + '.png', buf.length, 'bytes');
}

const run = (win, code) => win.webContents.executeJavaScript(code);

// Wait until `cond` (JS expression) is truthy in the page, or fail loudly so a
// wrong screenshot is never saved silently.
async function until(win, cond, label, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await run(win, `!!(${cond})`)) return;
    await wait(150);
  }
  throw new Error('screenshot precondition not met: ' + label);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: true,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await wait(1400); // boot + loadGpus + manifest

  // --- Swap in the studio image + its real catalog ---------------------------
  // Setting .value does not fire an input event, so the app's debounced
  // "image changed -> reload catalog" handler stays quiet.
  let studio = null;
  try {
    studio = JSON.parse(fs.readFileSync(STUDIO_MANIFEST, 'utf8'));
  } catch {
    console.log('studio manifest not found — using the mock catalog');
  }
  if (studio && Array.isArray(studio.models)) {
    await run(win, `
      (function(){
        window.MODEL_CATALOG = ${JSON.stringify(studio.models)};
        document.getElementById('imageName').value = ${JSON.stringify(STUDIO_IMAGE)};
        var note = document.getElementById('modelSource');
        note.textContent = '✓ ${studio.models.length} models from image label';
        note.style.color = 'var(--green)';
        renderModelList();
        updateSummary();
      })();
    `);
  } else {
    await run(win, `document.getElementById('imageName').value = ${JSON.stringify(STUDIO_IMAGE)};`);
  }

  // Tick a realistic selection that features the newest packs: LTX-2.3 Dev FP8,
  // LTX-2.5 int8 (low VRAM) and MiniMax-H3.
  const tick = `
    (function(){
      ['DOWNLOAD_LTX23_DEV_FP8', 'DOWNLOAD_LTX25_INT8', 'DOWNLOAD_MINIMAX_H3'].forEach(function(env){
        var el = document.querySelector('#modelList input[data-env="' + env + '"]');
        if (el && !el.checked) el.click();
      });
      var card = document.querySelector('.gpu-card');
      if (card) card.click();
    })();
  `;
  await run(win, tick);

  // 01 — Deploy hero: GPUs, live prices, availability, balance.
  await run(win, `document.querySelector('.content').scrollTop = 0;`);
  await shoot(win, '01-deploy');

  // 05 — Model packs: auto-sized volume, "new pods only" warning, and a pack
  // expanded to show exactly which LoRAs it contains. Needs a taller window.
  win.setContentSize(W, 1240);
  await wait(500);
  await run(win, `
    (function(){
      var row = document.querySelector('#mdl-DOWNLOAD_LTX23_LORAS');
      var det = row && row.closest('.model-row').querySelector('details');
      if (det) det.open = true;
      var field = document.getElementById('refreshModelsBtn').closest('.field');
      document.querySelector('.content').scrollTop = field.offsetTop - 24;
    })();
  `);
  await shoot(win, '05-models');

  // 07 — The newest packs (LTX-2.5, MiniMax-H3, tools) where they sit in the
  // list, with LTX-2.5's IC-LoRAs expanded.
  await run(win, `
    (function(){
      var open = document.querySelector('#mdl-DOWNLOAD_LTX23_LORAS').closest('.model-row').querySelector('details');
      if (open) open.open = false;
      var l = document.querySelector('#mdl-DOWNLOAD_LTX25_LORAS').closest('.model-row').querySelector('details');
      if (l) l.open = true;
      var row = document.querySelector('#mdl-DOWNLOAD_MINIMAX_H3').closest('.model-row');
      row.scrollIntoView({ block: 'start' });
      document.querySelector('.content').scrollTop -= 110;
    })();
  `);
  await shoot(win, '07-new-models');
  win.setContentSize(W, H);
  await wait(500);

  // 02 — Pods, with the live Progress / Logs panel open on the running pod.
  await run(win, `showTab('pods')`);
  await until(win, `document.getElementById('tab-pods').classList.contains('active')`, 'pods tab active');
  await until(win, `document.querySelector('#podsList .pod-card')`, 'pod cards rendered');
  await run(win, `toggleProgress('a1b2c3d4e5')`);
  await until(win, `document.querySelector('#prog-a1b2c3d4e5 .ptimeline')`, 'progress panel rendered');
  await shoot(win, '02-pods');

  // 03 — App request log.
  await run(win, `showTab('logs')`);
  await until(win, `document.getElementById('tab-logs').classList.contains('active') && document.querySelector('#logView .log-line')`, 'logs rendered');
  await shoot(win, '03-logs');

  // 04 — Settings: manifest URL, HuggingFace token, kill switch armed.
  await run(win, `
    showTab('settings');
    var s = document.getElementById('onCloseSelect');
    if (s) { s.value = 'terminate'; updateKillSwitchUI(); }
  `);
  await wait(300);
  await shoot(win, '04-settings');

  // 06 — Cost meter in its low-balance state (cropped to the sidebar card).
  await run(win, `showTab('deploy'); renderBalance({ balance: 6.1, spendPerHr: 0.74 });`);
  await wait(400);
  const r = await run(win, `
    (function(){
      var b = document.getElementById('costMeter').getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    })();
  `);
  const pad = 10;
  await shoot(win, '06-low-balance', {
    x: Math.max(0, Math.floor(r.x) - pad),
    y: Math.max(0, Math.floor(r.y) - pad),
    width: Math.ceil(r.width) + pad * 2,
    height: Math.ceil(r.height) + pad * 2,
  });

  app.quit();
});
