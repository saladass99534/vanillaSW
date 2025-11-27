const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const express = require('express');

let mainWindow;
let wsServer;
let webServer;
let wsClientForGuest;

// --- Main Window Creation ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../assets/icon.png')
  });

  const startURL = process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, '../dist/index.html')}`;
  mainWindow.loadURL(startURL);
  
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

// Get Tailscale Status
ipcMain.handle('get-tailscale-status', () => {
  return new Promise((resolve, reject) => {
    // Mac requires a specific path if installed from App Store
    const command = process.platform === 'darwin' ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json' : 'tailscale status --json';
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Tailscale exec error: ${error}`);
        return reject(stderr);
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject('Failed to parse Tailscale status JSON');
      }
    });
  });
});

// Get Desktop Sources
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

// --- Web Server for Browser Viewers ---
ipcMain.on('toggle-web-server', (event, enable) => {
    if (enable && !webServer) {
        const expressApp = express();
        expressApp.use(express.static(path.join(__dirname, '../dist')));
        webServer = expressApp.listen(8080, '0.0.0.0', () => {
            console.log('Web server for viewers started on port 8080');
        });
    } else if (!enable && webServer) {
        webServer.close();
        webServer = null;
        console.log('Web server stopped.');
    }
});


// --- Host Signaling Server ---
ipcMain.on('start-host-server', (event, port = 65432) => {
  if (wsServer) {
    wsServer.close();
  }
  wsServer = new WebSocketServer({ port });
  
  wsServer.on('listening', () => {
    mainWindow.webContents.send('host-server-started', { success: true, port });
  });

  wsServer.on('connection', (ws, req) => {
    const socketId = `ws-${Date.now()}-${Math.random()}`;
    ws.id = socketId;

    mainWindow.webContents.send('host-client-connected', { socketId });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        mainWindow.webContents.send('host-signal-received', { socketId, data });
      } catch(e) { /* ignore parse error */ }
    });

    ws.on('close', () => {
      mainWindow.webContents.send('host-client-disconnected', { socketId });
    });
    
    ws.on('error', (err) => {
        console.error(`WebSocket error for ${socketId}:`, err);
    });
  });

  wsServer.on('error', (err) => {
    mainWindow.webContents.send('host-server-started', { success: false, error: err.message });
  });
});

ipcMain.on('stop-host-server', () => {
  if (wsServer) {
    wsServer.close(() => {
        console.log('Host WebSocket server stopped.');
    });
    wsServer = null;
  }
});

ipcMain.on('host-send-signal', (event, socketId, data) => {
  if (wsServer) {
    wsServer.clients.forEach((client) => {
      if (client.id === socketId && client.readyState === client.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }
});

// --- Guest Connection Logic ---
ipcMain.on('connect-to-host', (event, ip, port = 65432) => {
    if(wsClientForGuest) {
        wsClientForGuest.close();
    }
    
    wsClientForGuest = new (require('ws'))(`ws://${ip}:${port}`);
    
    wsClientForGuest.on('open', () => {
        mainWindow.webContents.send('guest-connected');
    });
    
    wsClientForGuest.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            mainWindow.webContents.send('guest-signal-received', data);
        } catch(e) { /* ignore */ }
    });
    
    wsClientForGuest.on('error', (err) => {
        mainWindow.webContents.send('guest-error', err.message);
    });
    
    wsClientForGuest.on('close', () => {
        mainWindow.webContents.send('guest-disconnected');
    });
});

ipcMain.on('guest-send-signal', (event, data) => {
    if (wsClientForGuest && wsClientForGuest.readyState === wsClientForGuest.OPEN) {
        wsClientForGuest.send(JSON.stringify(data));
    }
});
