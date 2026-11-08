# ComfyUI RunPod Launcher v1.4.1

## Saved keys no longer outlive the app

The app keeps your RunPod API key and HuggingFace token on your own PC. Until now,
**uninstalling did not remove them**, so reinstalling started already signed in with
the old key. That is how a key typed on one computer could still be there after the
app was removed.

- **The uninstaller now deletes your saved keys and settings.** Installing a newer
  version over an old one still keeps them, so updates do not sign you out.
- **New: Settings → Forget saved keys.** Removes your RunPod key *and* your HuggingFace
  token in one step. (*Change key* only ever cleared the RunPod key.)
- The README now explains plainly where keys are stored and what the encryption does
  and does not protect against. In short: it stops the files working on another PC or
  Windows account, but not for whoever uses your own Windows account.

> **If you ever gave someone your RunPod key**, replace it: delete the old key in the
> RunPod console (Settings → API Keys) and create a new one. Removing the app from their
> PC does not remove the key from your account.

## ComfyUI Studio is the only image

The app deploys `bishoy22/comfyui-studio:latest` and nothing else.

- The Docker image setting is now read-only.
- An image saved by an older version is ignored, so upgrading no longer leaves anyone
  pointed at the retired `comfyui-wan` image.
- The built-in fallback model list is gone. It belonged to `comfyui-wan`, and a copy kept
  for Studio would drift from the image. If the model list cannot be read the app says so,
  and you can still deploy a bare ComfyUI.

**If you are on v1.4.0 or earlier, please update:** those versions still default to the
retired `comfyui-wan` image.

## Download
Grab the installer below. Windows may show a SmartScreen prompt (the installer is not
code-signed yet) — click **More info → Run anyway**. Install over any earlier version;
your settings are kept.
