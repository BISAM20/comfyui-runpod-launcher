# ComfyUI RunPod Launcher v1.2.1

## Fix — the model list now really does follow the image

In v1.2.0 the model list only updated if a pod was already running the image, so
switching to a different image (for example `bishoy22/comfyui-studio:latest`)
still showed the built-in list.

The app now reads the catalog **straight from the image on Docker Hub**, before
any pod exists:

- Images carrying a `com.comfyui.models` label provide the full catalog —
  names, descriptions and sizes.
- Any other image still works: the app reads its `DOWNLOAD_*` environment
  variables and lists exactly those models, with sizes shown as `size ?`.
- A running pod on the same image is still used as a final source.

Change the image in **Settings → Docker image** and the model list reloads to
match it automatically. The status line under the list tells you where the
catalog came from.

### Also in this release
- Auto volume sizing accounts for models with unpublished sizes, assuming a
  conservative amount so the volume is never under-provisioned (shown as `≥`).
- A pod is only used as a catalog source when its image matches the one you are
  deploying.
- Model names derived from environment variables are formatted properly
  (`LTX23 Dev FP8`, `WAN22 T2V`).

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.2.1.exe`** below. Windows may show a
SmartScreen prompt (the app isn't code-signed) — click **More info → Run anyway**.
Install over the top of any earlier version; your API key and settings are kept.
