# ComfyUI RunPod Launcher v1.3.1

Fixes two ways the app could let you select models and then quietly download
nothing.

## Models apply to a new pod — the app now says so

Model selections are baked into a pod when it is **created**. RunPod cannot
change a running pod's environment, so ticking models never affected an existing
pod, not even across Stop/Start — and nothing in the UI said so.

The Deploy tab now shows a clear warning whenever you already have a pod,
explaining that the models will apply to the **next** pod you deploy.

## No more silently wrong download flags

The built-in fallback model list belongs to `bishoy22/comfyui-wan`. If the app
could not reach an image's manifest it showed that list for **any** image — so
ticking "All LoRAs" for a different image set a `DOWNLOAD_*` flag that image
does not declare. Its `start.sh` ignores unknown flags, so the pod deployed
happily and downloaded nothing, with no error anywhere.

Now:
- the fallback list is only used for the image it was written for;
- for any other image the app shows an explicit error and **no** model rows,
  rather than offering flags that would do nothing;
- the model list starts empty at launch instead of briefly showing the built-in
  list before the real catalog loads.

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.3.1.exe`** below. Windows may show a
SmartScreen prompt (the app isn't code-signed) — click **More info → Run anyway**.
Install over any earlier version; your API key and settings are kept.
