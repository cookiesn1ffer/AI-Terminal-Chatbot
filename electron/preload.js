'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function addIpcListener(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

// ── AI Agent API ──────────────────────────────────────────────────────────────
// Used by the chat interface.
contextBridge.exposeInMainWorld('electronAPI', {

  sendMessage: (payload)   => ipcRenderer.invoke('agent:message', payload),
  getModels:   (ollamaUrl) => ipcRenderer.invoke('agent:get-models', ollamaUrl),
  runCommand:    (command, cwd) => ipcRenderer.invoke('run-command', { command, cwd }),
  cancelCommand: (id)          => ipcRenderer.invoke('cancel-command', id),
  tabComplete:   (input, cwd)  => ipcRenderer.invoke('tab-complete', { input, cwd }),

  // Streaming events
  onStreamToken:     (cb) => addIpcListener('stream:token', cb),
  onStreamEnd:       (cb) => addIpcListener('stream:end', cb),
  onCommandOutput:   (cb) => addIpcListener('cmd:output', cb),
  onCommandDone:     (cb) => addIpcListener('cmd:done', cb),
  onCommandStart:    (cb) => addIpcListener('command-start', cb),
  onCommandStream:   (cb) => addIpcListener('command-stream', cb),
  onCommandComplete: (cb) => addIpcListener('command-complete', cb),

  clearListeners: () => {
    ['stream:token', 'stream:end', 'cmd:output', 'cmd:done', 'command-start', 'command-stream', 'command-complete']
      .forEach(ch => ipcRenderer.removeAllListeners(ch));
  },

  // Session persistence
  loadSessions:  ()        => ipcRenderer.invoke('sessions:load'),
  saveSession:   (session) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id)      => ipcRenderer.invoke('sessions:delete', id),

  // Settings
  loadSettings: ()      => ipcRenderer.invoke('settings:load'),
  saveSettings: (prefs) => ipcRenderer.invoke('settings:save', prefs),

  platform: process.platform,
});

// ── Terminal API ──────────────────────────────────────────────────────────────
// Used by Terminal.jsx to communicate with the PTY backend.
contextBridge.exposeInMainWorld('terminalAPI', {

  /**
   * Spawn a PTY session.
   * @param {{ id: string, cols: number, rows: number, cwd?: string }} opts
   * @returns {Promise<{ success: boolean, shell?: string, error?: string }>}
   */
  start: (opts) => ipcRenderer.invoke('terminal:start', opts),

  /**
   * Send keyboard input to the PTY.
   * Uses ipcRenderer.send (fire-and-forget) to minimise keystroke latency.
   * @param {string} id
   * @param {string} data
   */
  sendInput: (id, data) => ipcRenderer.send('terminal:input', { id, data }),

  /**
   * Notify the PTY of a size change.
   * @param {string} id
   * @param {number} cols
   * @param {number} rows
   */
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),

  /**
   * Terminate a PTY session.
   * @param {string} id
   */
  kill: (id) => ipcRenderer.invoke('terminal:kill', { id }),

  /**
   * Register a callback for PTY output data.
   * Called very frequently -- keep the callback fast.
   * @param {function({ id: string, data: string }): void} cb
   */
  onData: (cb) => addIpcListener('terminal:data', cb),

  /**
   * Register a callback for shell exit events.
   * @param {function({ id: string, exitCode: number }): void} cb
   */
  onExit: (cb) => addIpcListener('terminal:exit', cb),

  /** Remove all terminal IPC listeners (call in useEffect cleanup). */
  clearListeners: () => {
    ['terminal:data', 'terminal:exit']
      .forEach(ch => ipcRenderer.removeAllListeners(ch));
  },
});

// ── Plugin API ────────────────────────────────────────────────────────────────
// Used by PluginBlock.jsx and any code that needs to interact with plugins.
contextBridge.exposeInMainWorld('pluginAPI', {

  /**
   * Return metadata for all loaded plugins.
   * @returns {Promise<{ success: boolean, plugins: Array, error?: string }>}
   */
  listPlugins: () => ipcRenderer.invoke('agent:list-plugins'),

  /**
   * Execute a plugin by name.
   * @param {string} name   - Plugin name (e.g. "filesystem", "system", "nmap")
   * @param {object} input  - Input object forwarded to the plugin
   * @returns {Promise<{ success: boolean, plugin: string, data?: any, duration: number, error?: string }>}
   */
  executePlugin: (name, input) =>
    ipcRenderer.invoke('agent:execute-plugin', { name, input }),

  /**
   * Register a callback for plugin result push-events.
   * The main process fires 'plugin:result' after every executePlugin call.
   * @param {function(result: object): void} cb
   */
  onPluginResult: (cb) => addIpcListener('plugin:result', cb),

  /** Remove all plugin IPC listeners. */
  clearPluginListeners: () => {
    ipcRenderer.removeAllListeners('plugin:result');
  },
});
