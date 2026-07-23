// =============================================================================
// Catalog of downloadable models. Each entry maps a friendly UI row to the
// environment variable flag the Docker image's start.sh understands.
//
// `gb` is the approximate size added to the /workspace volume (used to warn if
// the chosen volume disk is too small). Values match the image README.
// =============================================================================

window.MODEL_CATALOG = [
  {
    env: 'DOWNLOAD_WAN22_T2V',
    name: 'Wan 2.2 — Text-to-Video',
    desc: 'High + low noise fp8 (14B)',
    gb: 28.6,
  },
  {
    env: 'DOWNLOAD_WAN22_I2V',
    name: 'Wan 2.2 — Image-to-Video',
    desc: 'High + low noise fp8 (14B)',
    gb: 28.6,
  },
  {
    env: 'DOWNLOAD_VACE_21',
    name: 'Wan 2.1 VACE (GGUF)',
    desc: 'Q5_K_M quantized',
    gb: 9.5,
  },
  {
    env: 'DOWNLOAD_VACE_SKYREELS',
    name: 'VACE SkyReels V3 R2V',
    desc: 'Used by Mickmumpitz AI Renderer',
    gb: 14,
  },
  {
    env: 'DOWNLOAD_WAN_FUN_CONTROL_22',
    name: 'Wan Fun Control 2.2',
    desc: 'High + low noise fp8',
    gb: 28.6,
  },
  {
    env: 'DOWNLOAD_WAN_ANIMATE_V2',
    name: 'Wan Animate v2',
    desc: 'fp8 + ONNX pose models',
    gb: 17.5,
  },
  {
    env: 'DOWNLOAD_MOCHA',
    name: 'Mocha (preview)',
    desc: 'Wan2.1-based fp8',
    gb: 14.3,
  },
  {
    env: 'DOWNLOAD_LTX',
    name: 'LTX-2.3 (22B)',
    desc: 'Model + Gemma encoder + upscalers + control LoRAs',
    gb: 55,
  },
  {
    env: 'DOWNLOAD_LORAS',
    name: 'All LoRAs',
    desc: 'FusionX, lightx2v, SVI + your private LoRAs (needs HF token)',
    gb: 10,
    needsHfToken: true,
  },
];
