// =============================================================================
// Preload — exposes a minimal, safe API surface to the renderer.
// The renderer can only call these named channels; it has no Node access.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // settings / key
  hasApiKey: () => invoke('settings:hasApiKey'),
  validateAndSaveKey: (key) => invoke('settings:validateAndSave', key),
  clearApiKey: () => invoke('settings:clearApiKey'),
  getDeployDefaults: () => invoke('settings:getDeployDefaults'),
  saveDeployDefaults: (obj) => invoke('settings:saveDeployDefaults', obj),
  setOnClose: (action) => invoke('settings:setOnClose', action),
  onClosing: (cb) => {
    const handler = (_evt, action) => cb(action);
    ipcRenderer.on('app:closing', handler);
    return () => ipcRenderer.removeListener('app:closing', handler);
  },

  // runpod
  gpuTypes: () => invoke('runpod:gpuTypes'),
  createPod: (opts) => invoke('runpod:createPod', opts),
  listPods: () => invoke('runpod:listPods'),
  getPod: (id) => invoke('runpod:getPod', id),
  stopPod: (id) => invoke('runpod:stopPod', id),
  startPod: (id) => invoke('runpod:startPod', id),
  deletePod: (id) => invoke('runpod:deletePod', id),
  podProgress: (id) => invoke('runpod:podProgress', id),

  // misc
  openExternal: (url) => invoke('app:openExternal', url),

  // logs
  getLogs: () => invoke('logs:get'),
  clearLogs: () => invoke('logs:clear'),
  onLog: (cb) => {
    const handler = (_evt, entry) => cb(entry);
    ipcRenderer.on('log:entry', handler);
    return () => ipcRenderer.removeListener('log:entry', handler);
  },
});
