const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Fix: Add window control methods
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // System Info
  getTailscaleStatus: () => ipcRenderer.invoke('get-tailscale-status'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  
  // Web Server Toggle
  toggleWebServer: (enable) => ipcRenderer.send('toggle-web-server', enable),
  
  // Host Server Methods
  startHostServer: (port) => ipcRenderer.send('start-host-server', port),
  stopHostServer: () => ipcRenderer.send('stop-host-server'), // New method
  
  onHostServerStarted: (callback) => {
    ipcRenderer.removeAllListeners('host-server-started');
    ipcRenderer.on('host-server-started', (_, res) => callback(res));
  },
  onHostClientConnected: (callback) => {
    ipcRenderer.removeAllListeners('host-client-connected');
    ipcRenderer.on('host-client-connected', (_, res) => callback(res));
  },
  onHostClientDisconnected: (callback) => {
    ipcRenderer.removeAllListeners('host-client-disconnected');
    ipcRenderer.on('host-client-disconnected', (_, res) => callback(res));
  },
  onHostSignalReceived: (callback) => {
    ipcRenderer.removeAllListeners('host-signal-received');
    ipcRenderer.on('host-signal-received', (_, res) => callback(res));
  },
  hostSendSignal: (socketId, data) => ipcRenderer.send('host-send-signal', { socketId, data }),

  // Guest Client Methods
  connectToHost: (ip, port) => ipcRenderer.send('connect-to-host', ip, port),
  onGuestConnected: (callback) => {
    ipcRenderer.removeAllListeners('guest-connected');
    ipcRenderer.on('guest-connected', () => callback());
  },
  onGuestSignalReceived: (callback) => {
    ipcRenderer.removeAllListeners('guest-signal-received');
    ipcRenderer.on('guest-signal-received', (_, data) => callback(data));
  },
  onGuestError: (callback) => {
    ipcRenderer.removeAllListeners('guest-error');
    ipcRenderer.on('guest-error', (_, err) => callback(err));
  },
  onGuestDisconnected: (callback) => {
    ipcRenderer.removeAllListeners('guest-disconnected');
    ipcRenderer.on('guest-disconnected', () => callback());
  },
  guestSendSignal: (data) => ipcRenderer.send('guest-send-signal', data),

  // Utility
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
