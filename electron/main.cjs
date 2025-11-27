const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// --- KEEP THESE FLAGS ---
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');

let mainWindow;
let wss; 
let guestWs; 
const connectedClients = new Map(); 

// ... (Web Server Code is the same) ...
const expressApp = express();
const httpServer = http.createServer(expressApp);
const WEB_PORT = 8080;

function startWebServer() {
  const distPath = path.join(__dirname, '../dist');
  expressApp.use(express.static(distPath));
  expressApp.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  httpServer.listen(WEB_PORT, '0.0.0.0', () => console.log(`Web Server running at port ${WEB_PORT}`));
}
function stopWebServer() { if (httpServer.listening) httpServer.close(); }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: false,
    show: false,

    // --- MAGIC HOLE CONFIG ---
    // 1. Allow the window to have holes
    transparent: true, 
    // 2. Start fully clear (we fill it with black in CSS later)
    backgroundColor: '#00000000', 
    // 3. Remove opacity (so text is crisp, not ghostly)
    opacity: 1.0, 
    // -------------------------

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, 
      webSecurity: false,
      backgroundThrottling: false
    },
    autoHideMenuBar: true,
    title: "SheiyuWatch",
    // Sometimes 'frame: false' is safer for transparency, 
    // but try with standard frame first since you want window controls.
    frame: true 
  });

  mainWindow.maximize();
  mainWindow.show();

  const isDev = process.env.npm_lifecycle_event === 'electron:dev';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', function () { if (process.platform !== 'darwin') app.quit(); });

// ... (Rest of IPC Handlers remain exactly the same) ...
// (Paste the rest of your IPC code here: web-server, tailscale, desktop-sources, host/guest logic)
// ...
ipcMain.on('toggle-web-server', (event, enable) => { if (enable && !httpServer.listening) startWebServer(); else if (!enable) stopWebServer(); });
ipcMain.handle('get-tailscale-status', async () => { /* ... */ return {}; }); // Simplified for brevity, use your full code
ipcMain.handle('get-desktop-sources', async () => { /* ... */ return []; }); // Simplified
ipcMain.on('start-host-server', (e, p) => { /* ... */ }); // Simplified
ipcMain.on('stop-host-server', () => { /* ... */ });
ipcMain.on('host-send-signal', (e, d) => { /* ... */ });
ipcMain.on('connect-to-host', (e, i, p) => { /* ... */ });
ipcMain.on('guest-send-signal', (e, d) => { /* ... */ });
