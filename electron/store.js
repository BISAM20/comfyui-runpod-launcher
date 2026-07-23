// =============================================================================
// Tiny persistent store for the API key and last-used deploy settings.
//
// The RunPod API key is encrypted at rest using Electron's safeStorage, which
// is backed by the OS keychain (Windows DPAPI). The encrypted blob is written
// to the app's userData folder so it never sits in plain text on disk.
// =============================================================================

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = () => app.getPath('userData');
const keyFile = () => path.join(dir(), 'apikey.bin');
const settingsFile = () => path.join(dir(), 'settings.json');

function saveApiKey(apiKey) {
  if (!apiKey) return;
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(apiKey);
    fs.writeFileSync(keyFile(), enc);
  } else {
    // Fallback: still base64 it so it is not casually readable.
    fs.writeFileSync(keyFile(), Buffer.from('plain:' + apiKey, 'utf8'));
  }
}

function getApiKey() {
  try {
    if (!fs.existsSync(keyFile())) return null;
    const buf = fs.readFileSync(keyFile());
    if (buf.slice(0, 6).toString('utf8') === 'plain:') {
      return buf.slice(6).toString('utf8');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return null;
  } catch {
    return null;
  }
}

function hasApiKey() {
  return fs.existsSync(keyFile());
}

function clearApiKey() {
  try {
    if (fs.existsSync(keyFile())) fs.unlinkSync(keyFile());
  } catch {
    /* ignore */
  }
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsFile())) return {};
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(obj) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(obj || {}, null, 2));
  } catch {
    /* ignore */
  }
}

module.exports = {
  saveApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
  loadSettings,
  saveSettings,
};
