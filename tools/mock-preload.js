// Mock preload used only to generate README screenshots. Exposes the same
// window.api surface as the real preload, but returns realistic sample data so
// the UI renders fully without a RunPod account.
const { contextBridge } = require('electron');

const ok = (data) => Promise.resolve({ ok: true, data });
const now = Date.now();

const GPUS = [
  { id: 'g1', displayName: 'RTX PRO 6000', manufacturer: 'Nvidia', memoryInGb: 96,
    secure: { price: 1.99, spot: 0.9, stock: 'medium' }, community: null },
  { id: 'g2', displayName: 'A40', manufacturer: 'Nvidia', memoryInGb: 48,
    secure: { price: 0.44, spot: 0.2, stock: 'high' }, community: { price: 0.35, spot: 0.18, stock: 'high' } },
  { id: 'g3', displayName: 'RTX PRO 4500', manufacturer: 'Nvidia', memoryInGb: 32,
    secure: { price: 0.74, spot: 0.35, stock: 'high' }, community: null },
  { id: 'g4', displayName: 'H100 SXM', manufacturer: 'Nvidia', memoryInGb: 80,
    secure: { price: 2.99, spot: 1.6, stock: 'low' }, community: null },
  { id: 'g5', displayName: 'RTX 4090', manufacturer: 'Nvidia', memoryInGb: 24,
    secure: { price: 0.69, spot: 0.3, stock: 'high' }, community: { price: 0.44, spot: 0.22, stock: 'medium' } },
  { id: 'g6', displayName: 'L40S', manufacturer: 'Nvidia', memoryInGb: 48,
    secure: { price: 0.86, spot: 0.4, stock: 'high' }, community: null },
];

const PODS = [
  { id: 'a1b2c3d4e5', name: 'comfyui-pod', desiredStatus: 'RUNNING', costPerHr: 0.44,
    gpu: { displayName: 'A40' },
    comfyUrl: 'https://a1b2c3d4e5-8188.proxy.runpod.net',
    jupyterUrl: 'https://a1b2c3d4e5-8888.proxy.runpod.net' },
  { id: 'f6g7h8i9j0', name: 'wan-render', desiredStatus: 'EXITED', costPerHr: 1.99,
    gpu: { displayName: 'RTX PRO 6000' },
    comfyUrl: 'https://f6g7h8i9j0-8188.proxy.runpod.net',
    jupyterUrl: 'https://f6g7h8i9j0-8888.proxy.runpod.net' },
];

const LOGS = [
  { t: now - 9000, level: 'req', msg: 'GraphQL query' },
  { t: now - 8800, level: 'ok', msg: 'GraphQL ok' },
  { t: now - 7000, level: 'req', msg: 'REST GET /pods' },
  { t: now - 6800, level: 'ok', msg: 'REST GET /pods → 200' },
  { t: now - 4000, level: 'info', msg: 'Creating pod "comfyui-pod" — g2 ×1, SECURE, disk 50GB, vol 120GB' },
  { t: now - 3800, level: 'req', msg: 'REST POST /pods', detail: '{"body":{"name":"comfyui-pod","gpuTypeIds":["g2"],"containerDiskInGb":50,"volumeInGb":120}}' },
  { t: now - 3500, level: 'ok', msg: 'REST POST /pods → 201' },
];

contextBridge.exposeInMainWorld('api', {
  hasApiKey: () => ok(true),
  validateAndSaveKey: () => ok(true),
  clearApiKey: () => ok(true),
  getDeployDefaults: () => ok({ image: 'bishoy22/comfyui-wan:latest', containerDisk: 50, volumeDisk: 120, onClose: 'nothing' }),
  saveDeployDefaults: () => ok(true),
  setOnClose: (a) => ok(a),
  onClosing: () => () => {},
  hasHfToken: () => ok(true),
  saveHfToken: () => ok(true),
  clearHfToken: () => ok(true),
  balance: () => ok({ balance: 42.18, spendPerHr: 0.44 }),
  modelManifest: () => ok({
    source: 'pod',
    image: 'bishoy22/comfyui-wan:latest',
    models: [
      { env: 'DOWNLOAD_WAN22_T2V', name: 'Wan 2.2 — Text-to-Video', desc: 'High + low noise fp8 (14B)', gb: 28.6 },
      { env: 'DOWNLOAD_WAN22_I2V', name: 'Wan 2.2 — Image-to-Video', desc: 'High + low noise fp8 (14B)', gb: 28.6 },
      { env: 'DOWNLOAD_VACE_21', name: 'Wan 2.1 VACE (GGUF)', desc: 'Q5_K_M quantized', gb: 9.5 },
      { env: 'DOWNLOAD_VACE_SKYREELS', name: 'VACE SkyReels V3 R2V', desc: 'Used by Mickmumpitz AI Renderer', gb: 14 },
      { env: 'DOWNLOAD_WAN_FUN_CONTROL_22', name: 'Wan Fun Control 2.2', desc: 'High + low noise fp8', gb: 28.6 },
      { env: 'DOWNLOAD_WAN_ANIMATE_V2', name: 'Wan Animate v2', desc: 'fp8 + ONNX pose models', gb: 17.5 },
      { env: 'DOWNLOAD_MOCHA', name: 'Mocha (preview)', desc: 'Wan2.1-based fp8', gb: 14.3 },
      { env: 'DOWNLOAD_LTX', name: 'LTX-2.3 (22B)', desc: 'Model + Gemma encoder + upscalers + control LoRAs', gb: 55 },
      { env: 'DOWNLOAD_LORAS', name: 'All LoRAs', desc: 'FusionX, lightx2v, SVI + private LoRAs (needs HF token)', gb: 10, needsHfToken: true, items: ['Wan2.1_T2V_14B_FusionX_LoRA','Wan21_CausVid_14B_T2V_lora_rank32','lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16','t2v_lightx2v_high_noise_lora','t2v_lightx2v_low_noise_lora','SVI_v2_PRO_Wan2.2-I2V-A14B_HIGH_lora_rank_128_fp16','concept_slider_wan2.1_age','crowds_slider'] },
    ],
  }),
  gpuTypes: () => ok(GPUS),
  createPod: () => ok({ id: 'new123' }),
  listPods: () => ok(PODS),
  getPod: (id) => ok(PODS.find((p) => p.id === id) || PODS[0]),
  stopPod: () => ok(true),
  startPod: () => ok(true),
  deletePod: () => ok(true),
  podProgress: () => ok({ status: 'RUNNING', comfyReachable: true, comfyUrl: PODS[0].comfyUrl, logs: '[12:04:11] Container started — ComfyUI (self-contained image)\n[12:04:12] Log server listening on port 8189\n[UPDATE] Templates refreshed\n[DOWNLOADS] Wan2.2 T2V ... [DONE]\n[12:06:20] Starting ComfyUI on port 8188\nTo see the GUI go to: http://0.0.0.0:8188' }),
  openExternal: () => ok(true),
  getLogs: () => ok(LOGS),
  clearLogs: () => ok(true),
  onLog: () => () => {},
});
