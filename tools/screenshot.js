// Generates README screenshots by loading the real renderer with mock data.
// Run:  npx electron tools/screenshot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'assets', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, name) {
  await wait(600);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('saved', name + '.png');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1160,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await wait(1400); // boot + loadGpus

  // Deploy tab — select a GPU and tick a model so it looks used.
  await win.webContents.executeJavaScript(`
    (function(){
      var card = document.querySelector('.gpu-card');
      if (card) card.click();
      var m = document.querySelector('#modelList input');
      if (m) m.click();
      var c = document.querySelector('.content');
      if (c) c.scrollTop = 0;   // show the header in the hero shot
    })();
  `);
  await shoot(win, '01-deploy');

  await win.webContents.executeJavaScript("showTab('pods')");
  await wait(400);
  await shoot(win, '02-pods');

  await win.webContents.executeJavaScript("showTab('logs')");
  await wait(400);
  await shoot(win, '03-logs');

  await win.webContents.executeJavaScript(`
    showTab('settings');
    var s = document.getElementById('onCloseSelect');
    if (s) { s.value = 'terminate'; updateKillSwitchUI(); }
  `);
  await wait(300);
  await shoot(win, '04-settings');

  app.quit();
});
