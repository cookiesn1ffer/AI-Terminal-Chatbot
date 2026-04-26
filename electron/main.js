'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { registerHandlers } = require('./ipc-handlers');
const { terminalManager } = require('./terminal');
const { logError } = require('./logger');
const isDev = process.env.NODE_ENV === 'development';

// Keep reference to main window
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-fail-load', () => {
    console.error('Failed to load frontend');
  });

  // Show window once ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

// Register all IPC handlers once app is ready
app.whenReady().then(() => {
  registerHandlers(ipcMain, () => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

process.on('uncaughtException', (err) => {
  logError('main.uncaughtException', { error: err.message, stack: err.stack });
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox('Application Error', 'A background error occurred. Check logs/app.log for details.');
  }
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logError('main.unhandledRejection', { error: error.message, stack: error.stack });
});

app.on('window-all-closed', () => {
  terminalManager.killAll();
  if (process.platform !== 'darwin') app.quit();
});
