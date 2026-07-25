# ComfyUI RunPod Launcher

A friendly Windows desktop app to deploy a **ComfyUI GPU pod on RunPod** in one
click — pick a GPU with live pricing and availability, choose which AI models to
pre-download, launch, then open ComfyUI, watch progress, and stop or terminate
the pod. All from one window.

![Version](https://img.shields.io/badge/version-1.3.1-6d5efc)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0a7bbb)
![License](https://img.shields.io/badge/license-MIT-2ecc8f)
[![Download the installer](https://img.shields.io/badge/⬇%20Download-Installer-brightgreen)](https://github.com/BISAM20/comfyui-runpod-launcher/releases/latest)

---

**[Download](#download)** · **[Screenshots](#screenshots)** ·
**[Features](#features)** · **[Getting started](#getting-started)** ·
**[Images](#the-docker-images-it-deploys)** ·
**[Studio models & workflows](#comfyui-studio--models--workflows)** ·
**[Build from source](#build-from-source)** ·
**[Version history](#version-history)**

---

## Download

**[⬇ Download the latest installer](https://github.com/BISAM20/comfyui-runpod-launcher/releases/latest)**

Run `ComfyUI RunPod Launcher Setup.exe` and follow the installer. Because the app
is not yet code-signed, Windows SmartScreen may show a warning the first time —
click **More info → Run anyway**.

> Requires a [RunPod](https://runpod.io) account and an API key. The app runs
> locally on Windows 10/11; nothing is installed on your RunPod side beyond the
> pods you deploy.

---

## Screenshots

### Deploy — live GPU pricing & availability
![Deploy tab](assets/screenshots/01-deploy.png)

### My Pods — status, links, and controls
![My Pods tab](assets/screenshots/02-pods.png)

### Logs — every request, with secrets redacted
![Logs tab](assets/screenshots/03-logs.png)

### Settings — kill switch and defaults
![Settings tab](assets/screenshots/04-settings.png)

---

## Features

- **Live GPU pricing & availability** — only shows GPUs that are actually
  available, with High / Medium / Low badges and per-hour prices pulled straight
  from RunPod. Favourite GPUs pin to the top.
- **Cost meter** — live account balance, hourly burn rate, and estimated runtime
  remaining, with clear warnings before you run out of credit.
- **One-click deploy** — name the pod, pick Secure or Community, choose which
  models to pre-download, and launch. Container-disk guardrails prevent the
  common "machine does not have the resources" placement failure.
- **Automatic volume sizing** — the volume disk is sized from the models you
  select, plus 50 GB of headroom. Override it any time.
- **Model list comes from the image** — the downloadable models are published by
  the Docker image itself, so pointing the app at a different image changes the
  list to match. Each pack can be expanded to show exactly which files and LoRAs
  it contains before you download it.
- **HuggingFace token** — saved encrypted for gated or private models.
- **Pod management** — live status, direct **Open ComfyUI** and **JupyterLab**
  links, and **Stop** / **Start** / **Terminate** controls.
- **Progress / Logs** — a per-pod panel with a boot timeline, ComfyUI-readiness
  probe, and streaming container logs (image boot + model-download progress).
- **App request log** — every RunPod API call and error, with API keys and
  tokens automatically redacted.
- **Kill switch** — optionally stop or terminate running pods when the app is
  closed so nothing is left billing (off by default).
- **Encrypted key storage** — the RunPod API key is stored encrypted on the
  local machine (Windows DPAPI) and is only ever sent to RunPod.

---

## Getting started

1. Create a RunPod API key at
   [console.runpod.io/user/settings](https://console.runpod.io/user/settings) →
   **API Keys** → **+ Create API Key** (read/write).
2. Launch the app and paste the key on the first screen.
3. **Deploy** tab — name the pod, pick a GPU, tick the models to pre-download,
   then **Deploy Pod**.
4. **My Pods** tab — when the pod shows `RUNNING`, click **Open ComfyUI**.

**Stop vs Terminate:** *Stop* pauses billing and keeps downloaded models on the
volume; *Terminate* deletes the pod and its models. The app confirms before
terminating.

---

## The Docker images it deploys

Any ComfyUI image that uses `DOWNLOAD_*` environment variables works. Two are
maintained for this launcher — set one in **Settings → Docker image**:

| Image | Focus |
|---|---|
| `bishoy22/comfyui-studio:latest` | LTX-2.3 · Krea 2 · FLUX.2 Klein · Wan 2.x |
| `bishoy22/comfyui-wan:latest` | Wan 2.1 / 2.2 video + LTX-2.3 |

Both are self-contained (ComfyUI installed directly on a CUDA base, launched by
their own `start.sh`) and expose:

| Port | Service |
|---|---|
| `8188` | ComfyUI |
| `8888` | JupyterLab |
| `8189` | Read-only log server (powers the in-app Progress / Logs panel) |

Models are downloaded on demand via `DOWNLOAD_*` environment variables the app
sets for you, and are stored on the pod's `/workspace` volume so they survive
Stop/Start.

---

## `comfyui-studio` — models & workflows

Nothing is baked into the image except ComfyUI, the nodes and the workflows —
models download only when you tick them. **~421 GB if you selected everything**,
so pick per project; the app sizes the volume for you.

### Models

<!-- studio-models:start -->
**LTX-2.3 — video**

| Pack | What it is | Size | Files |
|---|---|---|---|
| **LTX-2.3 Dev (22B)** | Full-precision base video model | 46.1 GB | 1 |
| **LTX-2.3 Dev FP8** | Quantised base model - less VRAM | 29.1 GB | 1 |
| **LTX-2.3 Distilled** | Faster few-step base model | 46.1 GB | 1 |
| **LTX-2.3 Distilled FP8** | Quantised distilled model | 29.5 GB | 1 |
| **LTX-2.3 Upscalers** | Spatial x1.5/x2 and temporal x2 upscalers | 3.3 GB | 4 |
| **LTX-2.3 Distill LoRA** | Few-step distill LoRAs for the base model | 15.2 GB | 2 |
| **LTX-2.3 Kijai pack** | Kijai fp8 transformers, VAEs, text projection | ~22 GB | 1 |
| **LTX-2.3 Official LoRAs** | Lightricks IC/ID LoRAs - control, upscale, lipdub, HDR | ~14 GB | 21 |
| **LTX-2.3 Community LoRAs** | Community styles + Gemma abliterated encoders | 5.3 GB | 7 |

**Krea 2 — image**

| Pack | What it is | Size | Files |
|---|---|---|---|
| **Krea 2 Turbo** | Fast image model - fp8 + int8 | 26.6 GB | 2 |
| **Krea 2 RAW** | Photographic RAW model + turbo LoRA | 13.6 GB | 2 |
| **Krea 2 LoRAs** | Krea 2 style LoRAs | ~4 GB | 0 |

**FLUX.2 Klein — image**

| Pack | What it is | Size | Files |
|---|---|---|---|
| **FLUX.2 Klein 9B (fp8)** | Klein 9B image model, fp8 + base | ~20 GB | 2 |
| **FLUX.2 Klein 9B (bf16)** | Full-precision Klein 9B | ~34 GB | 1 |
| **FLUX.2 Klein extras** | BiRefNet, SeedVR2, VAE, ref-control, BFS head | 10.1 GB | 5 |

**Wan 2.x — video**

| Pack | What it is | Size | Files |
|---|---|---|---|
| **Wan 2.2 Text-to-Video** | High + low noise fp8 (14B) | 28.6 GB | 2 |
| **Wan 2.2 Image-to-Video** | High + low noise fp8 (14B) | 28.6 GB | 2 |
| **Wan Animate v2** | Animate 14B fp8 + YOLO/ViTPose detection | 18.6 GB | 3 |
| **Mocha (preview)** | Wan2.1-based preview model | 14.3 GB | 1 |
| **Wan LoRAs** | lightx2v 4-step, SVI, relight + private sliders | ~12 GB | 12 |
<!-- studio-models:end -->

Sizes marked `~` are estimates (the source repository is gated, so the exact
size could not be measured). Several LTX-2.3 Creative Lab IC-LoRAs and the
private Wan sliders are gated — set a **HuggingFace token** in Settings or they
are skipped with `[SKIP] HF_TOKEN not set` in the download log.

### Workflows

Baked in and available in ComfyUI's **Workflows** panel:

| Folder | Contents |
|---|---|
| `LTX-2.3/` | Official Lightricks LTX-2.3 example workflows |
| `LTX-2.3-community/` | Comfy-Org LTX-2.3 templates (community LoRAs) |
| `LTX-Video-other/` | Remaining ComfyUI-LTXVideo examples (LTX-2 and earlier) |
| `WhatDreamsCost/` | LTX Director / FFLF workflows |
| `Krea2/` | Comfy-Org Krea 2 templates |
| `FLUX2-Klein/` | One-node FLUX.2 Klein pipeline + NKD Klein Tools + Comfy-Org templates |
| `Wan2.2/` | Hearmeman Wan 2.2 workflows |
| `Wan-Animate/` | Hearmeman Wan Animate + KJ WanAnimate examples |
| `Wan-MoCha/` | KJ MoCha examples |

Workflow templates refresh on every pod start, so new upstream templates appear
without rebuilding the image (`AUTO_UPDATE_TEMPLATES=false` disables this).

### Custom nodes

ComfyUI-Manager, KJNodes, WanVideoWrapper, WanAnimatePreprocess, LTXVideo,
WhatDreamsCost, one-node-flux-2-klein, NKD-Klein-Tools, VideoHelperSuite,
Impact-Pack, controlnet_aux, Easy-Use, Florence2, segment-anything-2, RES4LYF,
Frame-Interpolation, GIMM-VFI, Detail-Daemon, RMBG, Inpaint-CropAndStitch,
UltimateSDUpscale, GGUF, DepthAnythingV3, DepthCrafter, Crystools, essentials,
Custom-Scripts, rgthree, Logic, cg-use-everywhere, advanced-model-manager.

### Model catalog (`models.json`)

The list of downloadable models is defined by the **image**, not the app — point
the app at a different image and the model list changes to match. The catalog is
resolved in this order, all before any pod exists:

1. **Manifest URL** — if one is set in **Settings → Model manifest URL**.
2. **The image on Docker Hub** — a `com.comfyui.models` label carrying the full
   catalog (names, descriptions, sizes). Images without that label still work:
   the app reads their `DOWNLOAD_*` environment variables and lists those, with
   sizes shown as unknown.
3. **A running pod** on the same image, which serves `models.json` on port 8189.

If none are reachable, the app falls back to a small built-in list — but **only
for the image that list was written for**. For any other image it shows an error
instead of guessing, because a `DOWNLOAD_*` flag an image does not declare is
silently ignored by its `start.sh`: the pod would deploy and download nothing.

> **Models are applied when a pod is created.** RunPod cannot change a running
> pod's environment, so ticking models has no effect on an existing pod — not
> even across Stop/Start. Deploy a new pod to add models.

```json
{
  "models": [
    {
      "env": "DOWNLOAD_WAN22_T2V",
      "name": "Wan 2.2 — Text-to-Video",
      "desc": "High + low noise fp8 (14B)",
      "gb": 28.6,
      "items": [
        "wan2.2_t2v_high_noise_14B_fp8_scaled",
        "wan2.2_t2v_low_noise_14B_fp8_scaled"
      ]
    }
  ]
}
```

`items` is optional — when present, the app shows an expandable list so you can
see exactly which models and LoRAs a pack contains. `approx: true` marks a size
as an estimate.

Add a model to the image (a `DOWNLOAD_*` flag in `start.sh` plus an entry here),
run `node gen-label.js` to refresh the image label, rebuild, and it appears in
the app automatically.

---

## Build from source

Requires [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start          # run in development
npm run dist       # build the Windows installer into release/
```

`npm run dist` produces `release/ComfyUI RunPod Launcher Setup <version>.exe`
(an NSIS installer). Double-clicking `Build Installer.bat` does the same.

### Project layout

| Path | Purpose |
|---|---|
| `electron/main.js` | Window, IPC, and all RunPod network calls (main process). |
| `electron/runpod.js` | RunPod client — REST for pods, GraphQL for GPU pricing. |
| `electron/store.js` | Encrypted API-key + settings storage. |
| `electron/logger.js` | In-app log bus with secret redaction. |
| `electron/preload.js` | Safe bridge exposed to the UI. |
| `renderer/` | UI — `index.html`, `styles.css`, `app.js`, `models.js`. |

`renderer/models.js` holds only the offline **fallback** catalog. The real model
list comes from the Docker image — see [Model catalog](#model-catalog-modelsjson)
above.

---

## Version history

Every release is listed here, newest first. Installers for all versions are on
the [releases page](https://github.com/BISAM20/comfyui-runpod-launcher/releases).

### v1.3.1 — Fix silently-ignored model selections
**Fixed**
- The built-in fallback model list was shown for **any** image when its manifest
  could not be read. Its `DOWNLOAD_*` flags belong to `comfyui-wan`; other images
  ignore unknown flags, so a pod deployed and downloaded nothing with no error.
  The fallback is now restricted to its own image, and other images show an
  explicit error with no model rows instead of flags that would do nothing.
- The model list no longer flashes the built-in list before the real catalog
  loads.

**Added**
- A warning on the Deploy tab whenever a pod already exists: models are applied
  **when a pod is created**, so ticking them cannot affect a running pod (RunPod
  cannot change a running pod's environment, not even across Stop/Start).

### v1.3.0 — See what's inside each model pack
**Added**
- Every model pack expands to list the exact models and LoRAs it downloads, so
  `LTX-2.3 Official LoRAs` is no longer an opaque flag name.
- Manifests gained an optional `items` array and an `approx` flag; estimated
  sizes display as `≈`.

**Changed**
- Packs published by an image show readable names, real descriptions and
  measured sizes instead of `LTX23 Loras — Declared by the image`.

### v1.2.1 — Model list follows the Docker image
**Fixed**
- The model list only refreshed from a running pod, so switching images kept
  showing the previous list. The catalog is now read from the image on Docker
  Hub before any pod exists — from a `com.comfyui.models` label when present,
  otherwise derived from the image's own `DOWNLOAD_*` environment variables.
- A running pod is only used as a catalog source when its image matches the one
  being deployed.
- Model names derived from environment variables are formatted properly
  (`LTX23 Dev FP8`, `WAN22 T2V`).

**Changed**
- Auto volume sizing assumes a conservative size for models with no published
  size rather than under-provisioning the volume (shown as `≥`).

### v1.2.0 — Cost meter, HuggingFace token, image-defined models
**Added**
- **Cost meter** — live account balance, hourly burn rate and estimated runtime
  remaining, with low-balance warnings.
- **HuggingFace token** — saved encrypted once in Settings and applied to every
  deploy, for gated or private models.
- **Model list from the Docker image** — the image publishes a `models.json`
  catalog the app reads, so updating the image updates the list.
- **Automatic volume sizing** — the volume disk is calculated from the selected
  models plus 50 GB of headroom; typing a value switches to manual.

### v1.1.0 — Availability, progress, and a kill switch
**Added**
- **Live GPU availability** — only available GPUs are listed, with High /
  Medium / Low badges; RTX PRO 6000, A40 and RTX PRO 4500 pin to the top.
- **Progress / Logs panel** — per-pod status timeline, ComfyUI-readiness probe
  and streaming container logs.
- **Logs tab** — every RunPod request and error, with secrets redacted.
- **Kill switch** — optionally stop or terminate running pods when the app
  closes (off by default).

**Fixed**
- Container-disk guardrails that prevent the common *"machine does not have the
  resources"* placement failure.

### v1.0.0 — First release
- Deploy a ComfyUI pod on RunPod: API key setup, GPU picker with live pricing,
  model pre-download selection, and Stop / Start / Terminate pod management.

---

## Notes

- The RunPod API key is stored encrypted locally and transmitted only to RunPod.
- The app is currently **unsigned**; a code-signing certificate would remove the
  Windows SmartScreen prompt.

## License

[MIT](LICENSE) © 2026 Bishoy
