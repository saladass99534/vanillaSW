const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  // --- General ---
  getTailscaleStatus: () => ipcRenderer.invoke('get-tailscale-status'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  setWindowOpacity: (opacity) => ipcRenderer.invoke('set-window-opacity', opacity),
  openVideoFile: () => ipcRenderer.invoke('open-video-file'),
  openSubtitleFile: () => ipcRenderer.invoke('open-subtitle-file'),

  // --- Web Server ---
  toggleWebServer: (enable) => ipcRenderer.send('toggle-web-server', enable),

  // --- Host ---
  startHostServer: (port) => ipcRenderer.send('start-host-server', port),
  stopHostServer: () => ipcRenderer.send('stop-host-server'),
  onHostServerStarted: (cb) => ipcRenderer.on('host-server-started', (event, ...args) => cb(...args)),
  onHostClientConnected: (cb) => ipcRenderer.on('host-client-connected', (event, ...args) => cb(...args)),
  onHostClientDisconnected: (cb) => ipcRenderer.on('host-client-disconnected', (event, ...args) => cb(...args)),
  onHostSignalReceived: (cb) => ipcRenderer.on('host-signal-received', (event, ...args) => cb(...args)),
  hostSendSignal: (socketId, data) => ipcRenderer.send('host-send-signal', { socketId, data }),

  // --- Guest ---
  connectToHost: (ip, port) => ipcRenderer.send('connect-to-host', ip, port),
  onGuestConnected: (cb) => ipcRenderer.on('guest-connected', (event, ...args) => cb(...args)),
  onGuestSignalReceived: (cb) => ipcRenderer.on('guest-signal-received', (event, ...args) => cb(...args)),
  onGuestError: (cb) => ipcRenderer.on('guest-error', (event, ...args) => cb(...args)),
  onGuestDisconnected: (cb) => ipcRenderer.on('guest-disconnected', (event, ...args) => cb(...args)),
  guestSendSignal: (data) => ipcRenderer.send('guest-send-signal', data),
  
  // --- Util ---
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
};

contextBridge.exposeInMainWorld('electron', electronAPI);
