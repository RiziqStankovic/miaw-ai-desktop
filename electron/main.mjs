import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Menu,
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  nativeImage,
  protocol,
  Tray
} from 'electron';

import { createCommandHandlers, initializeBackend } from './backend/commands.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const iconPath = path.join(projectRoot, 'public', 'miaw-logo.png');
const enableDevTools = process.env.THUKI_ENABLE_DEVTOOLS?.trim() === 'true';
const openDevToolsOnStart =
  process.env.THUKI_OPEN_DEVTOOLS_ON_START?.trim() === 'true';
const lockWindowPosition = process.env.THUKI_LOCK_WINDOW_POSITION?.trim() !== 'false';
const toggleShortcut =
  process.env.THUKI_TOGGLE_SHORTCUT?.trim() || 'CommandOrControl+Space';
const newChatShortcut =
  process.env.THUKI_NEW_CHAT_SHORTCUT?.trim() || 'CommandOrControl+Alt+Space';
const quitShortcut =
  process.env.THUKI_QUIT_SHORTCUT?.trim() || 'CommandOrControl+Shift+Q';

let mainWindow = null;
let tray = null;

function quitApp() {
  app.isQuiting = true;
  app.quit();
}

function showWindow({ forceNewSession = false } = {}) {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.setOpacity(0);
  mainWindow.show();
  mainWindow.focus();

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send('thuki:event', {
      event: 'thuki://visibility',
      payload: {
        state: 'show',
        selected_text: null,
        window_x: null,
        window_y: null,
        screen_bottom_y: null,
        force_new_session: forceNewSession
      }
    });

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.setOpacity(1);
    }, 70);
  }, 16);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: iconPath,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(projectRoot, 'electron', 'preload.mjs'),
      contextIsolation: true,
      sandbox: false,
      devTools: enableDevTools
    }
  });

  if (lockWindowPosition) {
    mainWindow.setMovable(false);
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (enableDevTools) {
      return;
    }

    const key = input.key?.toLowerCase();
    const opensDevTools =
      key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');

    if (opensDevTools) {
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    if (enableDevTools && openDevToolsOnStart) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function toggleWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.webContents.send('thuki:event', {
      event: 'thuki://visibility',
      payload: { state: 'hide-request' }
    });
  } else {
    showWindow();
  }
}

function setupTray() {
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.setToolTip('Miaw');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => {
          if (!mainWindow) {
            return;
          }
          if (!mainWindow.isVisible()) {
            showWindow();
          } else {
            mainWindow.focus();
          }
        }
      },
      {
        label: 'New Chat',
        click: () => {
          showWindow({ forceNewSession: true });
        }
      },
      {
        label: 'Hide',
        click: () => {
          if (mainWindow?.isVisible()) {
            toggleWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitApp();
        }
      }
    ])
  );
  tray.on('click', toggleWindow);
}

app.whenReady().then(async () => {
  app.setName('Miaw');
  protocol.handle('asset', (request) => {
    const url = new URL(request.url);
    const encodedPath = url.pathname.startsWith('/')
      ? url.pathname.slice(1)
      : url.pathname;
    const filePath = decodeURIComponent(encodedPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  const backend = await initializeBackend({
    app,
    getWindow: () => mainWindow
  });

  const handlers = createCommandHandlers({
    app,
    backend,
    getWindow: () => mainWindow
  });

  ipcMain.handle('thuki:invoke', async (_event, { cmd, args }) => {
    const handler = handlers[cmd];
    if (!handler) {
      throw new Error(`Unknown command: ${cmd}`);
    }
    return handler(args ?? {});
  });

  createWindow();
  setupTray();

  globalShortcut.register(toggleShortcut, toggleWindow);
  globalShortcut.register(newChatShortcut, () => showWindow({ forceNewSession: true }));
  globalShortcut.register(quitShortcut, quitApp);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
});
