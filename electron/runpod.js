// =============================================================================
// RunPod API client — runs in the Electron MAIN process (no CORS restrictions).
//
// Two APIs are used:
//   * REST    (https://api.runpod.io/v2)      — create / list / stop / delete pods
//   * GraphQL (https://api.runpod.io/graphql) — live GPU types + pricing
//
// RunPod retired the old REST host (rest.runpod.io/v1, which no longer resolves
// in DNS) in favour of the v2 API. v2 renamed most pod fields, so every pod that
// comes back is run through normalizePod(), which also fills in the legacy field
// names (desiredStatus, costPerHr, gpu.displayName …) the rest of the app reads.
//
// The API key is passed per-call so the caller controls where it is stored.
// =============================================================================

const log = require('./logger');

const REST_BASE = 'https://api.runpod.io/v2';
const GRAPHQL_URL = 'https://api.runpod.io/graphql';

// Container ports exposed by the Docker image (see the image's README).
const COMFYUI_PORT = 8188;
const JUPYTER_PORT = 8888;
const LOG_PORT = 8189; // read-only log server added in start.sh

// -----------------------------------------------------------------------------
// Network errors. Node's fetch only says "fetch failed"; the real reason
// (DNS failure, refused, timeout …) is in err.cause, so surface it.
// -----------------------------------------------------------------------------
function describeNetworkError(err) {
  const cause = err && err.cause;
  const code = cause && (cause.code || cause.name);
  const detail = cause && cause.message && cause.message !== err.message ? cause.message : '';
  const base = (err && err.message) || String(err);
  return [base, code && `(${code})`, detail && `— ${detail}`].filter(Boolean).join(' ');
}

// RunPod v2 errors look like { title, status, detail, errors: [...] }; v1 and
// the GraphQL gateway used { error } / { message }.
function describeApiError(data, res) {
  if (data && typeof data === 'object') {
    const main = data.detail || data.error || data.message || data.title;
    const extra = Array.isArray(data.errors) && data.errors.length ? data.errors.join('; ') : '';
    if (main || extra) {
      const text = typeof main === 'string' ? main : main ? JSON.stringify(main) : '';
      return [text, extra && `(${extra})`].filter(Boolean).join(' ');
    }
  }
  return `RunPod API error ${res.status} ${res.statusText}`;
}

// -----------------------------------------------------------------------------
// Low-level REST helper
// -----------------------------------------------------------------------------
async function restRequest(apiKey, method, path, body) {
  log.req(`REST ${method} ${path}`, body ? { body } : undefined);
  let res;
  try {
    res = await fetch(`${REST_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    const why = describeNetworkError(netErr);
    log.error(`Network error on ${method} ${path}`, { error: why });
    throw new Error(`Network error reaching RunPod: ${why}`);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const msg = describeApiError(data, res);
    log.error(`REST ${method} ${path} → ${res.status}`, {
      status: res.status,
      response: data,
    });
    throw new Error(msg);
  }
  log.ok(`REST ${method} ${path} → ${res.status}`);
  return data;
}

// -----------------------------------------------------------------------------
// GraphQL helper — GPU types & pricing are not in the REST API.
// -----------------------------------------------------------------------------
async function graphqlRequest(apiKey, query, variables) {
  log.req('GraphQL query');
  let res;
  try {
    res = await fetch(`${GRAPHQL_URL}?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (netErr) {
    const why = describeNetworkError(netErr);
    log.error('Network error on GraphQL', { error: why });
    throw new Error(`Network error reaching RunPod: ${why}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.errors) {
    const msg =
      (data && data.errors && data.errors[0] && data.errors[0].message) ||
      `RunPod GraphQL error ${res.status}`;
    log.error(`GraphQL → ${res.status}`, { status: res.status, errors: data && data.errors });
    throw new Error(msg);
  }
  log.ok('GraphQL ok');
  return data.data;
}

// -----------------------------------------------------------------------------
// Account balance + current hourly spend (GraphQL `myself`).
// -----------------------------------------------------------------------------
async function getBalance(apiKey) {
  const query = `query { myself { clientBalance currentSpendPerHr } }`;
  const data = await graphqlRequest(apiKey, query);
  const m = (data && data.myself) || {};
  return {
    balance: typeof m.clientBalance === 'number' ? m.clientBalance : null,
    spendPerHr: typeof m.currentSpendPerHr === 'number' ? m.currentSpendPerHr : 0,
  };
}

// -----------------------------------------------------------------------------
// Validate an API key by making a cheap authenticated call.
// -----------------------------------------------------------------------------
async function validateKey(apiKey) {
  // Listing one pod is cheap and requires a valid key.
  await restRequest(apiKey, 'GET', '/pods?limit=1');
  return true;
}

// -----------------------------------------------------------------------------
// List GPU types with live pricing AND availability (GraphQL).
//
// Availability differs per cloud, so we ask for both Secure and Community in a
// single query using field aliases. `stockStatus` is RunPod's live availability
// ("High" | "Medium" | "Low"); it is null/empty when the GPU is out of stock.
// Returns each GPU with a `secure` and `community` sub-object (or null).
// -----------------------------------------------------------------------------
async function listGpuTypes(apiKey) {
  const priceFields = `
    uninterruptablePrice
    minimumBidPrice
    stockStatus
    rentedCount
    totalCount
  `;
  const query = `
    query GpuTypes {
      gpuTypes {
        id
        displayName
        manufacturer
        memoryInGb
        secureCloud
        communityCloud
        maxGpuCount
        secure: lowestPrice(input: { gpuCount: 1, secureCloud: true }) { ${priceFields} }
        community: lowestPrice(input: { gpuCount: 1, secureCloud: false }) { ${priceFields} }
      }
    }
  `;
  const data = await graphqlRequest(apiKey, query);

  // Normalize a raw lowestPrice block into { price, spot, stock } or null.
  const norm = (lp, cloudFlag) => {
    if (!lp || !cloudFlag) return null;
    const price =
      typeof lp.uninterruptablePrice === 'number' ? lp.uninterruptablePrice : null;
    const stock = normalizeStock(lp.stockStatus, lp.rentedCount, lp.totalCount);
    // Hide only when there is no price, or the GPU is *explicitly* out of stock.
    // 'unknown' (API didn't report a signal) is kept so the list is never empty
    // just because of a schema surprise.
    if (price == null || stock === 'none') return null;
    return {
      price,
      spot: typeof lp.minimumBidPrice === 'number' ? lp.minimumBidPrice : null,
      stock, // 'high' | 'medium' | 'low' | 'unknown'
    };
  };

  const types = (data.gpuTypes || [])
    .map((g) => ({
      id: g.id,
      displayName: g.displayName,
      manufacturer: g.manufacturer,
      memoryInGb: g.memoryInGb,
      maxGpuCount: g.maxGpuCount,
      secure: norm(g.secure, g.secureCloud),
      community: norm(g.community, g.communityCloud),
    }))
    // Keep only GPUs available in at least one cloud right now.
    .filter((g) => g.secure || g.community)
    .sort((a, b) => {
      const pa = (a.secure || a.community).price;
      const pb = (b.secure || b.community).price;
      return pa - pb;
    });

  return types;
}

// Map RunPod's stockStatus string (+ counts as a fallback) to a simple level.
// Returns 'high' | 'medium' | 'low' | 'none' (definitely unavailable) |
// 'unknown' (no signal reported).
function normalizeStock(status, rented, total) {
  if (typeof status === 'string' && status.trim()) {
    const s = status.trim().toLowerCase();
    if (s === 'high') return 'high';
    if (s === 'medium' || s === 'med') return 'medium';
    if (s === 'low') return 'low';
    if (s === 'unavailable' || s === 'none' || s === 'out of stock' || s === 'null')
      return 'none';
    // Some unexpected but present string — assume available (don't hide).
    return 'low';
  }
  // No status string: infer from free capacity if we have counts.
  if (typeof total === 'number' && total > 0) {
    const free = total - (typeof rented === 'number' ? rented : 0);
    if (free <= 0) return 'none';
    const ratio = free / total;
    if (ratio > 0.5) return 'high';
    if (ratio > 0.2) return 'medium';
    return 'low';
  }
  // Nothing to go on — don't claim unavailable, mark unknown.
  return 'unknown';
}

// -----------------------------------------------------------------------------
// Create a pod running the ComfyUI image.
//
// opts = {
//   name, imageName, gpuTypeId, gpuCount, cloudType ('SECURE'|'COMMUNITY'),
//   containerDiskInGb, volumeInGb, env (object), interruptible (bool)
// }
// -----------------------------------------------------------------------------
async function createPod(apiKey, opts) {
  // RunPod v2 rejects unknown properties (422), so only documented fields go out.
  // `dataCenterIds` is left out on purpose: with it unset the scheduler picks a
  // data center that currently has capacity for this GPU (avoids the
  // "This machine does not have the resources" error from pinning a full one).
  const body = {
    name: opts.name || 'comfyui-pod',
    image: opts.imageName,
    cloud: opts.cloudType === 'COMMUNITY' ? 'COMMUNITY' : 'SECURE',
    gpu: { id: opts.gpuTypeId, count: opts.gpuCount || 1 },
    disk: opts.containerDiskInGb || 30,
    mounts: { persistent: { size: opts.volumeInGb || 100, path: '/workspace' } },
    ports: [
      `${COMFYUI_PORT}/http`,
      `${JUPYTER_PORT}/http`,
      `${LOG_PORT}/http`,
      '22/tcp',
    ],
    env: opts.env || {},
  };
  log.info(
    `Creating pod "${body.name}" — ${opts.gpuTypeId} ×${body.gpu.count}, ` +
      `${body.cloud}, disk ${body.disk}GB, vol ${body.mounts.persistent.size}GB`
  );
  return normalizePod(await restRequest(apiKey, 'POST', '/pods', body));
}

// -----------------------------------------------------------------------------
// List / get / lifecycle
// -----------------------------------------------------------------------------
async function listPods(apiKey) {
  // Results are cursor-paginated: keep following nextCursor so no pod is missed
  // (a missed pod could escape the kill switch and keep billing).
  const pods = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const q = `?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await restRequest(apiKey, 'GET', `/pods${q}`);
    pods.push(...(Array.isArray(data) ? data : (data && data.pods) || []));
    const pg = data && data.pagination;
    if (!pg || !pg.hasNextPage || !pg.nextCursor) break;
    cursor = pg.nextCursor;
  }
  return pods.map(normalizePod);
}

async function getPod(apiKey, podId) {
  const data = await restRequest(apiKey, 'GET', `/pods/${encodeURIComponent(podId)}`);
  return normalizePod(data);
}

// v2 has a single state-transition endpoint: POST /pods/{id}/action
// with { action: 'start' | 'stop' | 'restart' | 'terminate' }.
async function podAction(apiKey, podId, action) {
  return restRequest(apiKey, 'POST', `/pods/${encodeURIComponent(podId)}/action`, { action });
}

async function stopPod(apiKey, podId) {
  return podAction(apiKey, podId, 'stop');
}

async function startPod(apiKey, podId) {
  return podAction(apiKey, podId, 'start');
}

async function deletePod(apiKey, podId) {
  return podAction(apiKey, podId, 'terminate');
}

// -----------------------------------------------------------------------------
// Turn a v2 pod into the shape the UI and main process were written against:
// keeps every v2 field, adds the legacy names, and adds the service URLs.
// -----------------------------------------------------------------------------
function normalizePod(pod) {
  if (!pod || !pod.id) return pod;
  const gpu = pod.gpu
    ? { ...pod.gpu, displayName: pod.gpu.displayName || String(pod.gpu.id || '').replace(/^NVIDIA\s+/i, '') }
    : pod.gpu;
  return {
    ...pod,
    gpu,
    // v2 statuses: PROVISIONING, STARTING, RUNNING, EXITED, ERROR, TERMINATED.
    desiredStatus: pod.desiredStatus || pod.status,
    costPerHr: pod.costPerHr != null ? pod.costPerHr : pod.cost,
    imageName: pod.imageName || pod.image,
    containerDiskInGb: pod.containerDiskInGb != null ? pod.containerDiskInGb : pod.disk,
    volumeInGb:
      pod.volumeInGb != null
        ? pod.volumeInGb
        : pod.mounts && pod.mounts.persistent
          ? pod.mounts.persistent.size
          : undefined,
    lastStatusChange: pod.lastStatusChange || pod.startedAt || pod.createdAt,
    comfyUrl: `https://${pod.id}-${COMFYUI_PORT}.proxy.runpod.net`,
    jupyterUrl: `https://${pod.id}-${JUPYTER_PORT}.proxy.runpod.net`,
    logUrl: `https://${pod.id}-${LOG_PORT}.proxy.runpod.net`,
  };
}

// -----------------------------------------------------------------------------
// Live progress helpers — these hit the pod's public proxy (no API key needed).
// -----------------------------------------------------------------------------
async function fetchWithTimeout(url, ms, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Is ComfyUI actually serving yet? Returns { reachable, status }.
async function probeComfy(podId) {
  const url = `https://${podId}-${COMFYUI_PORT}.proxy.runpod.net/`;
  try {
    const res = await fetchWithTimeout(url, 7000, { redirect: 'manual' });
    // ComfyUI returns 200 once up; RunPod's proxy returns 5xx while not ready.
    return { reachable: res.status >= 200 && res.status < 400, status: res.status };
  } catch (e) {
    return { reachable: false, status: 0, error: String(e && e.message) };
  }
}

// -----------------------------------------------------------------------------
// Fetch the model catalog that ships inside the Docker image.
//
// The list of downloadable models is defined by the IMAGE, not the app. It can
// come from an explicit URL (raw JSON) or from any running pod, which publishes
// /models.json on its log server. Returns the parsed { models: [...] }.
// -----------------------------------------------------------------------------
async function fetchModelManifest({ url, podId }) {
  const target = url || (podId ? `https://${podId}-${LOG_PORT}.proxy.runpod.net/models.json` : null);
  if (!target) throw new Error('No manifest source available');

  const res = await fetchWithTimeout(target, 9000);
  if (!res.ok) throw new Error(`Manifest fetch failed (${res.status})`);

  const data = await res.json();
  const models = Array.isArray(data) ? data : data.models;
  if (!Array.isArray(models) || !models.length) {
    throw new Error('Manifest contained no models');
  }
  // Keep only well-formed entries so a bad manifest can't break the UI.
  const clean = models
    .filter((m) => m && typeof m.env === 'string' && typeof m.name === 'string')
    .map((m) => ({
      env: m.env,
      name: m.name,
      desc: typeof m.desc === 'string' ? m.desc : '',
      gb: Number(m.gb) > 0 ? Number(m.gb) : 0,
      needsHfToken: !!m.needsHfToken,
    }));
  if (!clean.length) throw new Error('Manifest entries were invalid');

  log.ok(`Model manifest loaded (${clean.length} models) from ${url ? 'URL' : 'pod'}`);
  return { models: clean, source: url ? 'url' : 'pod', image: data.image || null };
}

// -----------------------------------------------------------------------------
// Read the model catalog straight from the image on Docker Hub.
//
// This works BEFORE any pod exists, and for any public image. Two sources, best
// first:
//   1. a `com.comfyui.models` label holding the rich catalog JSON (names,
//      descriptions, sizes) — present on images built for this launcher;
//   2. otherwise the image's own DOWNLOAD_* environment variables, which every
//      ComfyUI image of this family declares. Names are humanised and sizes are
//      unknown, but the list is always correct for that image.
// -----------------------------------------------------------------------------
const REGISTRY = 'https://registry-1.docker.io/v2';
const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
].join(',');

// "bishoy22/comfyui-studio:latest" -> { repo: 'bishoy22/comfyui-studio', tag: 'latest' }
function parseImageRef(image) {
  const ref = String(image || '').trim();
  if (!ref) throw new Error('No image name set');
  // Only Docker Hub is supported for metadata reads.
  if (/^[^/]+\.[^/]+\//.test(ref)) throw new Error('Only Docker Hub images supported');
  const [namePart, tagPart] = ref.split(':');
  const repo = namePart.includes('/') ? namePart : `library/${namePart}`;
  return { repo, tag: tagPart || 'latest' };
}

async function registryConfig(image) {
  const { repo, tag } = parseImageRef(image);

  const tokenRes = await fetchWithTimeout(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
    9000
  );
  if (!tokenRes.ok) throw new Error('Could not authenticate with Docker Hub');
  const { token } = await tokenRes.json();

  const headers = { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT };

  let res = await fetchWithTimeout(`${REGISTRY}/${repo}/manifests/${tag}`, 12000, { headers });
  if (!res.ok) throw new Error(`Image not found on Docker Hub (${res.status})`);
  let manifest = await res.json();

  // Multi-arch index → pick the linux/amd64 manifest.
  if (Array.isArray(manifest.manifests) && manifest.manifests.length) {
    const amd =
      manifest.manifests.find(
        (m) => m.platform && m.platform.architecture === 'amd64' && m.platform.os === 'linux'
      ) || manifest.manifests[0];
    res = await fetchWithTimeout(`${REGISTRY}/${repo}/manifests/${amd.digest}`, 12000, { headers });
    if (!res.ok) throw new Error('Could not read image manifest');
    manifest = await res.json();
  }

  const digest = manifest.config && manifest.config.digest;
  if (!digest) throw new Error('Image has no config blob');

  // fetch() follows the blob redirect automatically.
  const blob = await fetchWithTimeout(`${REGISTRY}/${repo}/blobs/${digest}`, 15000, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!blob.ok) throw new Error('Could not read image config');
  const cfg = await blob.json();
  return cfg.config || {};
}

// DOWNLOAD_WAN22_T2V -> "Wan22 T2V";  DOWNLOAD_LTX23_DEV_FP8 -> "LTX23 Dev FP8"
function humaniseEnv(env) {
  const KEEP = new Set([
    'T2V', 'I2V', 'V2V', 'FP8', 'FP16', 'BF16', 'GGUF', 'ONNX', 'VACE', 'LTX',
    'SVI', 'RAW', 'HD', 'AI', '2D', '3D',
  ]);
  // Tokens stay upper-case when they are known acronyms, very short, or
  // version-like (contain a digit) — e.g. WAN22, LTX23, T2V, VACE.
  const keepUpper = (w) =>
    KEEP.has(w) || w.length <= 4 || (/\d/.test(w) && w.length <= 6);

  return env
    .replace(/^DOWNLOAD_/, '')
    .split('_')
    .filter(Boolean)
    .map((w) =>
      keepUpper(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()
    )
    .join(' ');
}

function normaliseModels(models) {
  return models
    .filter((m) => m && typeof m.env === 'string' && typeof m.name === 'string')
    .map((m) => ({
      env: m.env,
      name: m.name,
      desc: typeof m.desc === 'string' ? m.desc : '',
      gb: Number(m.gb) > 0 ? Number(m.gb) : 0, // 0 = size unknown
      needsHfToken: !!m.needsHfToken,
      approx: !!m.approx, // size is an estimate, not measured
      items: Array.isArray(m.items) ? m.items.filter((s) => typeof s === 'string') : [],
    }));
}

async function fetchManifestFromRegistry(image) {
  const cfg = await registryConfig(image);

  // 1) Rich catalog in a label (JSON, optionally base64-encoded).
  const labels = cfg.Labels || {};
  const raw = labels['com.comfyui.models'] || labels['com.bishoy.comfyui.models'];
  if (raw) {
    try {
      const text = raw.trim().startsWith('{') || raw.trim().startsWith('[')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(text);
      const models = normaliseModels(Array.isArray(parsed) ? parsed : parsed.models || []);
      if (models.length) {
        log.ok(`Model catalog from image label (${models.length} models)`);
        return { models, source: 'image label', image };
      }
    } catch (e) {
      log.error('Image label catalog was invalid, falling back to env vars');
    }
  }

  // 2) Derive from the image's own DOWNLOAD_* env vars.
  const envs = (cfg.Env || [])
    .map((e) => String(e).split('=')[0])
    .filter((n) => /^DOWNLOAD_[A-Z0-9_]+$/.test(n));
  const unique = [...new Set(envs)];
  if (!unique.length) throw new Error('Image declares no DOWNLOAD_* models');

  const models = unique.map((env) => ({
    env,
    name: humaniseEnv(env),
    desc: 'Declared by the image',
    gb: 0,
    needsHfToken: /LORA/.test(env),
  }));
  log.ok(`Model catalog from image env vars (${models.length} models)`);
  return { models, source: 'image env vars', image };
}

// Tail the in-image log server. Returns combined text of the available logs.
// Throws a clear error when the log server isn't reachable (old image / still
// booting).
async function fetchPodLogs(podId) {
  const base = `https://${podId}-${LOG_PORT}.proxy.runpod.net`;
  const files = ['progress.log', 'comfyui.log', 'update.log', 'downloads.log'];
  const sections = [];
  let anyOk = false;

  for (const f of files) {
    try {
      const res = await fetchWithTimeout(`${base}/${f}`, 8000);
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text) {
          sections.push(`===== ${f} =====\n${text}`);
          anyOk = true;
        }
      }
    } catch {
      /* try the next file */
    }
  }

  if (!anyOk) {
    throw new Error('LOG_SERVER_UNREACHABLE');
  }
  return sections.join('\n\n');
}

module.exports = {
  validateKey,
  getBalance,
  listGpuTypes,
  createPod,
  listPods,
  getPod,
  stopPod,
  startPod,
  deletePod,
  normalizePod,
  probeComfy,
  fetchPodLogs,
  fetchModelManifest,
  fetchManifestFromRegistry,
  COMFYUI_PORT,
  JUPYTER_PORT,
  LOG_PORT,
};
