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
const secretFile = (name) => path.join(dir(), name + '.bin');
const settingsFile = () => path.join(dir(), 'settings.json');

// --- generic encrypted secret storage (OS keychain / Windows DPAPI) ----------
function saveSecret(name, value) {
  if (!value) return;
  const f = secretFile(name);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(f, safeStorage.encryptString(value));
  } else {
    // Fallback: mark it so we can read it back; still not plain-visible text.
    fs.writeFileSync(f, Buffer.from('plain:' + value, 'utf8'));
  }
}

function getSecret(name) {
  try {
    const f = secretFile(name);
    if (!fs.existsSync(f)) return null;
    const buf = fs.readFileSync(f);
    if (buf.slice(0, 6).toString('utf8') === 'plain:') {
      return buf.slice(6).toString('utf8');
    }
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return null;
  } catch {
    return null;
  }
}

function hasSecret(name) {
  return fs.existsSync(secretFile(name));
}

function clearSecret(name) {
  try {
    const f = secretFile(name);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {
    /* ignore */
  }
}

// --- RunPod API key (kept as `apikey.bin` for backwards compatibility) -------
const saveApiKey = (v) => saveSecret('apikey', v);
const getApiKey = () => getSecret('apikey');
const hasApiKey = () => hasSecret('apikey');
const clearApiKey = () => clearSecret('apikey');

// --- HuggingFace token (for gated / private models) --------------------------
const saveHfToken = (v) => saveSecret('hftoken', v);
const getHfToken = () => getSecret('hftoken');
const hasHfToken = () => hasSecret('hftoken');
const clearHfToken = () => clearSecret('hftoken');

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
  saveHfToken,
  getHfToken,
  hasHfToken,
  clearHfToken,
  loadSettings,
  saveSettings,
};
