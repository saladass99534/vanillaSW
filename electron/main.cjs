const { app, BrowserWindow, ipcMain, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const net = require('net');
const { WebSocketServer } = require('ws');
const express = require('express');
const http = require('http');

let mainWindow;
let hostServer;
let hostSockets = new Map();
let guestSocket;

// --- NEW: Web Server variables ---
let webServer;
let webSocketServer;

const isWindows = process.platform === 'win32';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111',
      symbolColor: '#fff',
      height: 32
    },
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#111111',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (hostServer) hostServer.close();
  if (guestSocket) guestSocket.destroy();
  if (webServer) webServer.close();
  if (webSocketServer) webSocketServer.close();
});

// --- IPC Handlers ---

ipcMain.handle('get-tailscale-status', async () => {
  const command = isWindows ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  const args = ['status', '--json'];

  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        console.error(`Tailscale exec error: ${error.message}`);
        return reject(new Error('Tailscale CLI not found or failed.'));
      }
      if (stderr) {
        console.warn(`Tailscale stderr: ${stderr}`);
      }
      try {
        const status = JSON.parse(stdout);
        resolve(status);
      } catch (e) {
        reject(new Error('Failed to parse Tailscale status JSON.'));
      }
    });
  });
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 300 },
    fetchWindowIcons: true,
  });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('set-window-opacity', (event, opacity) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setOpacity(opacity);
});

ipcMain.handle('open-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
        { name: 'Videos', extensions: ['mkv', 'avi', 'mp4', 'mov', 'webm', 'flv', 'wmv'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
        const data = await fs.promises.readFile(filePath);
        return { path: filePath, data };
    } catch (e) {
        console.error("Failed to read video file:", e);
        return null;
    }
  }
  return null;
});

ipcMain.handle('open-subtitle-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Subtitles', extensions: ['srt', 'vtt'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { content, path: filePath };
    } catch (e) {
        console.error("Failed to read subtitle file:", e);
        return null;
    }
  }
  return null;
});


// --- P2P SERVER LOGIC (HOST) ---

ipcMain.on('start-host-server', (event, port = 65432) => {
  if (hostServer) {
    hostServer.close();
  }
  hostServer = net.createServer(socket => {
    const socketId = `socket-${Math.random().toString(36).substr(2, 9)}`;
    hostSockets.set(socketId, socket);

    mainWindow.webContents.send('host-client-connected', { socketId });

    socket.on('data', data => {
      try {
        const parsed = JSON.parse(data.toString());
        mainWindow.webContents.send('host-signal-received', { socketId, data: parsed });
      } catch (e) {
        console.error("Host couldn't parse data:", e);
      }
    });

    socket.on('close', () => {
      hostSockets.delete(socketId);
      mainWindow.webContents.send('host-client-disconnected', { socketId });
    });

    socket.on('error', (err) => {
      console.error(`Socket error (${socketId}):`, err.message);
    });
  });

  hostServer.listen(port, () => {
    mainWindow.webContents.send('host-server-started', { success: true, port });
  }).on('error', (err) => {
    mainWindow.webContents.send('host-server-started', { success: false, error: err.message });
  });
});

ipcMain.on('stop-host-server', () => {
  if (hostServer) {
    hostSockets.forEach(socket => socket.destroy());
    hostSockets.clear();
    hostServer.close();
    hostServer = null;
  }
});

ipcMain.on('host-send-signal', (event, { socketId, data }) => {
  const socket = hostSockets.get(socketId);
  if (socket) {
    if (typeof socket.send === 'function') { // Check if it's a WebSocket
        socket.send(JSON.stringify(data));
    } else { // It's a TCP socket
        socket.write(JSON.stringify(data));
    }
  }
});

// --- P2P CLIENT LOGIC (GUEST) ---

ipcMain.on('connect-to-host', (event, ip, port = 65432) => {
  if (guestSocket) {
    guestSocket.destroy();
  }
  guestSocket = new net.Socket();
  
  guestSocket.connect(port, ip, () => {
    mainWindow.webContents.send('guest-connected');
  });

  guestSocket.on('data', data => {
    try {
        const parsed = JSON.parse(data.toString());
        mainWindow.webContents.send('guest-signal-received', parsed);
    } catch(e) { console.error("Guest couldn't parse data", e) }
  });

  guestSocket.on('close', () => {
    mainWindow.webContents.send('guest-disconnected');
    guestSocket = null;
  });

  guestSocket.on('error', (err) => {
    mainWindow.webContents.send('guest-error', err.message);
    guestSocket = null;
  });
});

ipcMain.on('guest-send-signal', (event, data) => {
  if (guestSocket && !guestSocket.destroyed) {
    guestSocket.write(JSON.stringify(data));
  }
});

// --- WEB SERVER (for Web/Mobile viewers) ---
// FIXED: This now runs a full HTTP server to fix the "Upgrade is required" error.
ipcMain.on('toggle-web-server', (event, enable) => {
    if (enable && !webServer) {
        const expressApp = express();
        webServer = http.createServer(expressApp);
        webSocketServer = new WebSocketServer({ server: webServer });

        // Serve the static frontend files
        const distPath = path.join(__dirname, '../dist');
        expressApp.use(express.static(distPath));

        webSocketServer.on('connection', ws => {
            const socketId = `ws-socket-${Math.random().toString(36).substr(2, 9)}`;
            hostSockets.set(socketId, ws);
            
            mainWindow.webContents.send('host-client-connected', { socketId });

            ws.on('message', message => {
                try {
                    const parsed = JSON.parse(message.toString());
                    mainWindow.webContents.send('host-signal-received', { socketId, data: parsed });
                } catch(e) {}
            });

            ws.on('close', () => {
                hostSockets.delete(socketId);
                mainWindow.webContents.send('host-client-disconnected', { socketId });
            });

            ws.on('error', (err) => {
                console.error('WebSocket error:', err.message);
                hostSockets.delete(socketId);
                mainWindow.webContents.send('host-client-disconnected', { socketId });
            });
        });

        webServer.listen(8080, () => {
            console.log('Web server listening on port 8080');
        });

    } else if (!enable && webServer) {
        if (webSocketServer) {
            webSocketServer.close();
            webSocketServer = null;
        }
        if (webServer) {
            webServer.close();
            webServer = null;
        }
        console.log('Web server stopped');
    }
});
