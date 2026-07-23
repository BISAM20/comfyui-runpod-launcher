# ComfyUI RunPod Launcher

A friendly Windows desktop app to deploy your ComfyUI Docker image
(`bishoy22/comfyui-wan:latest`) on a RunPod GPU — pick a GPU with a live price,
choose which models to download, launch, then open ComfyUI, stop, or terminate
the pod. All from one window.

![tabs: Deploy · My Pods · Settings]

---

## For users (your friend)

1. Download and run **`ComfyUI RunPod Launcher Setup.exe`**.
   - Windows may show a blue "Windows protected your PC" box because the app
     isn't code-signed. Click **More info → Run anyway**. (See *Signing* below.)
2. Get a RunPod API key: <https://console.runpod.io/user/settings> → **API Keys**
   → **+ Create API Key** (read/write). Paste it into the app on first launch.
3. **Deploy tab** — name the pod, pick a GPU (prices are live), tick the models
   you want pre-downloaded, click **Deploy Pod**.
4. **My Pods tab** — once the pod says `RUNNING`, click **Open ComfyUI**.
   Use **Stop** to pause billing (keeps your models), **Terminate** to delete it.

> **Stop vs Terminate:** *Stop* pauses billing but keeps the volume disk (and
> your downloaded models). *Terminate* deletes the pod and its volume — models
> are gone. The app asks you to confirm before terminating.

The API key is stored **encrypted** on your own PC (Windows DPAPI via Electron
`safeStorage`). It is never uploaded anywhere except directly to RunPod.

---

## For the developer (you)

### Run in development

```bash
npm install
npm start
```

### Run it directly (no build)

Double-click **`Run ComfyUI Launcher.bat`**. On first run it installs
dependencies automatically, then launches the app. (Needs Node.js installed.)

### Build the shareable Windows installer

Double-click **`Build Installer.bat`** (or run `npm run dist`).

This produces **`release\ComfyUI RunPod Launcher Setup 1.0.0.exe`** — a single
~78 MB NSIS installer. **That one file is what you send your friend.** Upload it
to GitHub Releases, Google Drive, WeTransfer, etc. and share the link. Your
friend downloads it, double-clicks, installs, and uses their own RunPod key.

They need **nothing else installed** — Node, Electron, etc. are all bundled
inside the installer.

> **First build gotcha (already handled on this PC):** electron-builder extracts
> a `winCodeSign` helper that contains macOS symlinks, which Windows blocks
> unless you have **Developer Mode** on or run as **Administrator**. If a clean
> machine fails with *"Cannot create symbolic link… A required privilege is not
> held"*, either turn on Settings → System → For developers → **Developer Mode**,
> or run `Build Installer.bat` as Administrator, then rebuild.

> **Icon:** `assets/icon.ico` is already included (purple play button).

### Signing (removes the SmartScreen warning)

Unsigned apps trigger Windows SmartScreen. To remove it you need a code-signing
certificate (OV ~\$100–200/yr, or EV for instant reputation). Add to
`package.json` → `build.win`:

```json
"certificateFile": "cert.pfx",
"certificatePassword": "..."
```

Sharing with a friend without signing is fine — they just click
*More info → Run anyway* once.

---

## How it works

| Part | File | Notes |
|---|---|---|
| Window + IPC + RunPod calls | `electron/main.js` | All network calls run in the main process (no browser CORS limits). |
| RunPod API client | `electron/runpod.js` | REST `https://rest.runpod.io/v1` for pods; GraphQL `https://api.runpod.io/graphql` for GPU prices. |
| Encrypted key storage | `electron/store.js` | Windows DPAPI via `safeStorage`. |
| Safe bridge to the UI | `electron/preload.js` | Exposes only named channels to the renderer. |
| UI | `renderer/` | `index.html`, `styles.css`, `app.js`, `models.js`. |

### Deploy request

The app sends `POST /pods` with your image, the selected `gpuTypeIds`,
`containerDiskInGb`, `volumeInGb` (mounted at `/workspace`), ports
`8188/http` (ComfyUI) + `8888/http` (JupyterLab), and an `env` map where each
checked model sets its `DOWNLOAD_*=true` flag (matching the image's `start.sh`).

### ComfyUI URL

Once running, ComfyUI is reached at
`https://<pod-id>-8188.proxy.runpod.net` — the app builds this link for you.

---

## Model catalog

Defined in `renderer/models.js`, mapped to the image's env flags. To add/remove
a model, edit that one file — no other change needed.

## Changing the image

Set a different image in **Settings → Docker image**, or change `DEFAULT_IMAGE`
in `electron/main.js`.
