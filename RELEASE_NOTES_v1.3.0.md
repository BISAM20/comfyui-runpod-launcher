# ComfyUI RunPod Launcher v1.3.0

## See what's inside every model pack

Model packs no longer show only a flag name. Each row can now be expanded to
list **exactly which models and LoRAs it will download**, so you know what
`LTX-2.3 Official LoRAs` or `Wan LoRAs` actually contains before spending disk
and time on it.

- Click the **“N files”** link under any pack to see its contents by name.
- Packs published by an image now carry readable names, real descriptions and
  measured sizes instead of `LTX23 Loras — Declared by the image`.
- Sizes that could not be measured exactly are marked with `≈`.

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.3.0.exe`** below. Windows may show a
SmartScreen prompt (the app isn't code-signed) — click **More info → Run anyway**.
Install over any earlier version; your API key and settings are kept.

> **Note:** the readable names, sizes and file lists come from the image itself.
> Rebuild and push your image after updating its `models.json` (run
> `node gen-label.js` first) for the new details to appear. Until then the app
> still lists the image's models from its environment variables.
