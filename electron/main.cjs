const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// --- CRITICAL FIX 1: DISABLE WINDOWS "SLEEP" LOGIC ---
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows', 'true');
// -----------------------------------------------------

let mainWindow;
let wss; 
let guestWs; 
const connectedClients = new Map(); 

// --- WEB SERVER ---
const expressApp = express();
const httpServer = http.createServer(expressApp);
const WEB_PORT = 8080;

function startWebServer() {
  const distPath = path.join(__dirname, '../dist');
  expressApp.use(express.static(distPath));

  expressApp.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  httpServer.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`Web Server running at http://0.0.0.0:${WEB_PORT}`);
  });
  
  httpServer.on('error', (e) => {
      console.error("Web Server Error:", e);
  });
}

function stopWebServer() {
    if (httpServer.listening) {
        httpServer.close(() => {
            console.log('Web Server stopped');
        });
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: false, 
    show: false,       
    
    // --- CRITICAL FIX 2: THE LAYERED STRATEGY ---
    // Instead of fading the whole app (opacity: 0.99), we use 'transparent: true'.
    // This forces Windows DWM to render content behind this window.
    transparent: true, 
    
    // Set startup color to fully transparent (#00000000) so there is no white flash.
    // We will make it Solid Black via CSS in index.html.
    backgroundColor: '#00000000', 
    // --------------------------------------------

    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, 
      webSecurity: false,
      
      // --- CRITICAL FIX 3: DISABLE THROTTLING ---
      backgroundThrottling: false
    },
    autoHideMenuBar: true,
    title: "SheiyuWatch"
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

ipcMain.on('toggle-web-server', (event, enable) => {
    if (enable) {
        if (!httpServer.listening) startWebServer();
    } else {
        stopWebServer();
    }
});

ipcMain.handle('get-tailscale-status', async () => {
  return new Promise((resolve, reject) => {
    const isMac = process.platform === 'darwin';
    const possiblePaths = isMac ? [
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 
      '/usr/local/bin/tailscale', 
      '/opt/homebrew/bin/tailscale', 
      'tailscale' 
    ] : [
      'tailscale', 
      'C:\\Program Files\\Tailscale\\tailscale.exe' 
    ];

    const tryPath = (index) => {
      if (index >= possiblePaths.length) {
        console.warn("Tailscale binary not found in any known location.");
        resolve({}); 
        return;
      }
      const pathStr = possiblePaths[index];
      const cmd = pathStr.includes(' ') ? `"${pathStr}"` : pathStr;
      
      exec(`${cmd} status --json`, (error, stdout, stderr) => {
        if (!error && stdout) {
          try {
            const status = JSON.parse(stdout);
            resolve(status);
            return; 
          } catch (e) { }
        }
        tryPath(index + 1);
      });
    };
    tryPath(0);
  });
});

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({ 
      types: ['window', 'screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  } catch (error) {
    console.error("Error getting desktop sources:", error);
    return [];
  }
});

// --- HOST LOGIC ---

ipcMain.on('start-host-server', (event, port) => {
  try {
    if (wss) {
      wss.close();
      connectedClients.clear();
    }
    wss = new WebSocket.Server({ port: port || 65432 });

    wss.on('listening', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('host-server-started', { success: true, port: port || 65432 });
      }
    });

    wss.on('connection', (ws) => {
      const socketId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      connectedClients.set(socketId, ws);
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('host-client-connected', { socketId });
      }

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message);
          if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('host-signal-received', { socketId, data: parsed });
          }
        } catch (e) { console.error("Error parsing message", e); }
      });

      ws.on('close', () => {
        connectedClients.delete(socketId);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('host-client-disconnected', { socketId });
        }
      });
    });

    wss.on('error', (error) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('host-server-started', { success: false, error: error.message });
      }
    });

  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('host-server-started', { success: false, error: error.message });
    }
  }
});

ipcMain.on('stop-host-server', () => {
    if (wss) {
        connectedClients.forEach((ws) => ws.terminate());
        connectedClients.clear();
        wss.close();
        wss = null;
    }
});

ipcMain.on('host-send-signal', (event, { socketId, data }) => {
  const ws = connectedClients.get(socketId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
});

// --- GUEST LOGIC ---

ipcMain.on('connect-to-host', (event, ip, port) => {
  if (guestWs) guestWs.terminate();
  const url = `ws://${ip}:${port || 65432}`;

  try {
    guestWs = new WebSocket(url);
    guestWs.on('open', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest-connected');
    });
    guestWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest-signal-received', parsed);
      } catch (e) { }
    });
    guestWs.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest-error', err.message);
    });
    guestWs.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest-disconnected');
    });
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest-error', error.message);
  }
});

ipcMain.on('guest-send-signal', (event, data) => {
  if (guestWs && guestWs.readyState === WebSocket.OPEN) {
    guestWs.send(JSON.stringify(data));
  }
});
