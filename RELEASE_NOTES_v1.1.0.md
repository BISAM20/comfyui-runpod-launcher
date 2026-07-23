# ComfyUI RunPod Launcher v1.1.0

A friendly Windows app to deploy your ComfyUI GPU pod on RunPod in one click —
pick a GPU with live pricing, choose which models to pre-download, launch, then
open ComfyUI, watch progress, and stop or terminate — all from one window.

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.1.0.exe`** below and run it.
Windows may show a SmartScreen prompt (the app isn't code-signed) — click
**More info → Run anyway**.

## What's new in 1.1.0
- **Live GPU availability** — only shows GPUs that are actually available, with
  High / Medium / Low badges like the RunPod site.
- **Pinned GPUs** — RTX PRO 6000, A40, and RTX PRO 4500 always float to the top.
- **Progress / Logs panel** — per-pod live status timeline, ComfyUI readiness,
  and streaming container logs (boot + model-download progress).
- **App Logs tab** — every RunPod request and error, with secrets redacted.
- **Kill switch** — optionally stop or terminate running pods when you close the
  app so nothing is left billing (off by default; arm it in Settings).
- **Smarter deploy** — container-disk guardrails that prevent the common
  "machine does not have the resources" placement failure.

## First run
1. Get a RunPod API key: https://console.runpod.io/user/settings → **API Keys**.
2. Paste it into the app (stored encrypted on your PC only).
3. Deploy tab → pick a GPU + models → **Deploy Pod**.
4. My Pods → **Open ComfyUI** when it's ready.

**Stop vs Terminate:** *Stop* pauses billing and keeps your models; *Terminate*
deletes the pod and its models.
