// =============================================================================
// Tiny in-app logger. Keeps a ring buffer of recent entries and emits each new
// entry on an event bus so the main process can forward it to the UI.
//
// Secrets (API keys, HF tokens) must be redacted BEFORE calling log().
// =============================================================================

const { EventEmitter } = require('events');

const bus = new EventEmitter();
const buffer = [];
const MAX = 600;

function log(level, msg, detail) {
  const entry = {
    t: Date.now(),
    level, // 'info' | 'req' | 'ok' | 'error'
    msg: String(msg),
    detail: detail === undefined ? undefined : safeDetail(detail),
  };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  bus.emit('log', entry);
  return entry;
}

// Stringify detail safely and strip anything that looks like a secret.
function safeDetail(d) {
  let s;
  try {
    s = typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    s = String(d);
  }
  return redact(s);
}

function redact(s) {
  if (!s) return s;
  return String(s)
    // Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer «redacted»')
    // api_key=... in URLs / query strings
    .replace(/api_key=[^&\s"']+/gi, 'api_key=«redacted»')
    // RunPod / HF style keys
    .replace(/\b(rpa_[A-Za-z0-9]+)\b/g, '«redacted-key»')
    .replace(/\bhf_[A-Za-z0-9]+\b/g, '«redacted-hf»');
}

module.exports = {
  bus,
  buffer,
  redact,
  log,
  info: (m, d) => log('info', m, d),
  req: (m, d) => log('req', m, d),
  ok: (m, d) => log('ok', m, d),
  error: (m, d) => log('error', m, d),
};
