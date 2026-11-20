# ComfyUI RunPod Launcher v1.4.2

## Pods can be deployed again

If deploying showed **"Network error reaching RunPod: fetch failed"**, this is the fix.

RunPod switched off the server older versions used to create and manage pods
(`rest.runpod.io`) and moved to a new API at `api.runpod.io/v2`. GPU prices and your
balance kept loading because they come from a different service, but nothing that
creates, lists, stops, starts or terminates a pod could connect.

- **Deploy, Start, Stop and Terminate use the new API**, and so does signing in with a
  new key.
- **The kill switch works again.** It relies on the same calls, so on older versions it
  could not stop or terminate pods when you closed the app. It now reads every page of
  your pod list so no pod is missed.
- **The Logs tab shows the request log** (it was always empty in the installed app), and
  *Copy* copies it. Keys and tokens stay hidden in it.
- Network errors now say why (for example `ENOTFOUND` for a DNS failure) instead of only
  "fetch failed".

**v1.4.1 and earlier cannot deploy until updated.** Install over the old version; your
settings are kept.

> **If you used an older version recently**, open the
> [RunPod console](https://www.runpod.io/console/pods) and check that no pod is still
> running. Those versions could not stop pods when you closed the app, so one may still
> be billing.

## Download
Grab the installer below. Windows may show a SmartScreen prompt (the installer is not
code-signed yet) — click **More info → Run anyway**. Install over any earlier version;
your settings are kept.
