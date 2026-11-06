# ComfyUI RunPod Launcher v1.4.0

## ComfyUI opens by itself

Deploy a pod and walk away: as soon as ComfyUI is up, it opens in your default
browser. No more going to **My Pods** and clicking *Open ComfyUI*.

Pick the behaviour in **Settings → Open ComfyUI in my browser**:

- **Automatically, as soon as ComfyUI is ready** (default)
- **Automatically, once ComfyUI is ready and the model downloads have finished** —
  so everything you ticked is in place when the page appears
- **Never** — keep clicking *Open ComfyUI* yourself

It applies to pods you deploy *and* pods you start again. The setting is saved,
and changing it takes effect straight away, even for a pod that is still booting.

### Built to be careful
- It needs **two consecutive successful checks** before opening, so one flicker
  never opens an empty page.
- It **stops** if the pod exits or is terminated, and when you stop or terminate
  the pod yourself.
- It **gives up** after 40 minutes (6 hours when waiting for downloads) rather
  than watching forever, and it opens **once** per start.
- If an image does not publish download logs, the app opens ComfyUI anyway
  instead of waiting forever.
- A short notification tells you when it opened, or that it is waiting for
  downloads first.

> **Upgrading:** auto-open is **on by default**. If you would rather it didn't,
> set it to *Never* in Settings.

## Fixed
- The "models apply when a pod is created" notice showed from startup, and stayed
  up if the pod list could not be loaded. It hid itself with an inline style that
  the app's security policy blocks (introduced in v1.3.1).

## Download
Grab **`ComfyUI RunPod Launcher Setup 1.4.0.exe`** below. Windows may show a
SmartScreen prompt (the app isn't code-signed) — click **More info → Run anyway**.
Install over any earlier version; your API key and settings are kept.
