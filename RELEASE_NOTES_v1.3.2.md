# ComfyUI RunPod Launcher v1.3.2

## Bigger default volume

Auto volume sizing now adds **200 GB** of headroom on top of the models you
select, up from 50 GB.

- No models selected → the volume starts at **200 GB**.
- Each ticked model adds its own size on top, so LTX-2.3 Dev (46 GB) lands at
  ~255 GB, and Wan 2.2 T2V + VACE (38 GB) at ~247 GB.

That leaves room for generated output and for extra models pulled later from
ComfyUI-Manager without having to resize the pod.

Typing your own value still switches the field to manual; clear it to return to
automatic sizing.

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.3.2.exe`** below. Windows may show a
SmartScreen prompt (the app isn't code-signed) — click **More info → Run anyway**.
Install over any earlier version; your API key and settings are kept.
