# ComfyUI RunPod Launcher v1.2.0

Deploy a ComfyUI GPU pod on RunPod in one click — pick a GPU with live pricing
and availability, choose which models to pre-download, launch, then open
ComfyUI, watch progress, and stop or terminate.

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.2.0.exe`** below and run it.
Windows may show a SmartScreen prompt (the app isn't code-signed) — click
**More info → Run anyway**.

## What's new in 1.2.0

- **Cost meter** — the sidebar now shows your live RunPod balance, current
  hourly burn rate, and how much runtime you have left. It warns when funds get
  low, using whichever signal is more urgent: time remaining at the current rate,
  or an absolute low-balance floor.
- **HuggingFace token** — save a token once in Settings (stored encrypted) and
  it is applied automatically to every deploy, for gated or private models.
- **Model list now comes from the Docker image** — the image publishes a
  `models.json` catalog which the app reads from a running pod or a configurable
  URL. Updating the image updates the model list; no app update required.
- **Automatic volume sizing** — the volume disk is calculated from the models
  you tick, plus 50 GB of headroom. Type your own value any time to override.

## Upgrading
Install over the top of v1.1.0 — your saved API key and settings are kept.

> **Note:** the model-catalog and HuggingFace features rely on the latest
> `bishoy22/comfyui-wan` image. Rebuild/pull the image to get `models.json`
> published on the pod. Until then the app uses its built-in model list.
