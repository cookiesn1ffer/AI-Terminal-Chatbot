'use strict';

/**
 * ipc-handlers.js -- All Electron IPC channel handlers.
 *
 * Registered once at startup by main.js.
 * Covers:
 *   - AI agent: LLM streaming, model listing, background command execution
 *   - Terminal: PTY lifecycle (start / input / resize / kill)
 *   - Plugins: list and execute structured tool plugins
 *   - Sessions & Settings persistence
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');
const { listModels }                   = require('./llm-client');
const { runCommand }                   = require('./command-runner');
const { terminalManager, detectShell } = require('./terminal');
const { pluginManager }                = require('./pluginManager');
const { runAgentMessage }              = require('./agent-controller');
const { readRuntimeConfig }            = require('./runtime-config');
const { logError }                     = require('./logger');

const activeProcesses = new Map();
let commandCounter = 0;

function dataDir() {
  const dir = path.join(app.getPath('userData'), 'ata-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sessionsFile = () => path.join(dataDir(), 'sessions.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');

function defaultSettings() {
  const runtimeConfig = readRuntimeConfig();
  return {
    ollamaUrl:     'http://localhost:11434',
    model:         runtimeConfig.model || 'mistral',
    showRunButton: true,
    maxContext:    20,
    timeout:       runtimeConfig.timeout,
    maxOutput:     runtimeConfig.max_output,
  };
}

function cleanError(err, fallback) {
  return err && err.message ? err.message : fallback;
}

function withIpcErrorHandling(channel, handler) {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      const message = cleanError(err, `${channel} failed`);
      logError(`ipc.${channel}`, { error: message });
      return { success: false, error: message };
    }
  };
}

function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/i,
  // Note: && and ; intentionally omitted — they block legitimate pipelines
  /:\s*\(\)\s*\{.*\}/,   // fork bomb
  /dd\s+if=/i,
  />\s*\/dev\/sd[a-z]/i,
];

function createCommandId() {
  commandCounter += 1;
  return `cmd-${Date.now()}-${commandCounter}`;
}

function validateCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command must be a non-empty string');
  }

  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new Error('Blocked dangerous command');
  }

  return command.trim();
}

/**
 * Resolve a `cd` target against the current working directory.
 * Returns the new absolute path, or throws if it doesn't exist or isn't a dir.
 */
function resolveCd(target, currentCwd) {
  const base = currentCwd || os.homedir();

  // bare `cd` or `cd ~` → home
  if (!target || target === '~') return os.homedir();

  // Strip trailing path separator(s) first, then strip surrounding quotes.
  // This handles completions like "New folder"\ correctly:
  //   "New folder"\  →  "New folder"  →  New folder
  let cleaned = target.trim().replace(/[/\\]+$/, '');
  // Remove matching surrounding quotes (" or ')
  cleaned = cleaned.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

  // expand leading ~
  const expanded = cleaned.replace(/^~[/\\]?/, os.homedir() + path.sep);

  const resolved = path.resolve(base, expanded);

  if (!fs.existsSync(resolved)) {
    throw new Error(`cd: no such file or directory: ${target}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`cd: not a directory: ${target}`);
  }
  return resolved;
}

function streamSpawnedCommand(event, command, id, cwd) {
  const safeCommand = validateCommand(command);
  const workingDir  = cwd || os.homedir();

  // Use PowerShell on Windows so Unix-style commands (ls, cat, grep, etc.)
  // work via the built-in aliases. cmd.exe lacks these and produces exit code 1.
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const args  = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', safeCommand]
    : ['-c', safeCommand];

  const child = spawn(shell, args, {
    env:  process.env,
    cwd:  workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let completed = false;
  const finalize = (payload) => {
    if (completed) return;
    completed = true;
    activeProcesses.delete(id);
    event.sender.send('command-complete', payload);
  };

  activeProcesses.set(id, child);

  event.sender.send('command-start', {
    id,
    command: safeCommand,
    isRunning: true,
  });

  child.stdout.on('data', (data) => {
    event.sender.send('command-stream', {
      id,
      type: 'stdout',
      // Strip \r so PowerShell's \r\n line endings don't create blank lines in <pre>.
      data: data.toString().replace(/\r/g, ''),
    });
  });

  child.stderr.on('data', (data) => {
    event.sender.send('command-stream', {
      id,
      type: 'stderr',
      data: data.toString().replace(/\r/g, ''),
    });
  });

  child.on('error', (err) => {
    const errorMessage = cleanError(err, 'Command execution failed');
    event.sender.send('command-stream', {
      id,
      type: 'stderr',
      data: `${errorMessage}\n`,
    });
    logError('ipc.run-command', { id, command: safeCommand, error: errorMessage });
    finalize({
      id,
      exitCode: -1,
      error: errorMessage,
    });
  });

  child.on('close', (code) => {
    finalize({
      id,
      exitCode: code,
    });
  });
}

function cancelActiveCommand(id) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Command id must be a non-empty string');
  }

  const child = activeProcesses.get(id);
  if (!child) {
    return { success: false, error: 'Command not found', id };
  }

  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
        stdio: 'ignore',
      });
      killer.on('error', (err) => {
        logError('ipc.cancel-command', { id, error: cleanError(err, 'Could not cancel command on Windows') });
      });
    } else {
      child.kill('SIGTERM');
    }

    return { success: true, id };
  } catch (err) {
    const message = cleanError(err, 'Could not cancel command');
    activeProcesses.delete(id);
    logError('ipc.cancel-command', { id, error: message });
    return { success: false, error: message, id };
  }
}

function registerHandlers(ipcMain, getWindow) {
  ipcMain.handle('agent:message', withIpcErrorHandling('agent:message', async (event, payload) => {
    try {
      return await runAgentMessage({
        getWindow,
        messages:  payload.messages,
        settings:  payload.settings,
        messageId: payload.messageId,
      });
    } catch (err) {
      const errorMsg = err.message || 'LLM request failed';
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream:end', { messageId: payload.messageId, success: false, error: errorMsg });
      }
      return { success: false, error: errorMsg };
    }
  }));

  ipcMain.handle('agent:get-models', withIpcErrorHandling('agent:get-models', async (_event, ollamaUrl) => {
    try {
      const models = await listModels(ollamaUrl || 'http://localhost:11434');
      return { success: true, models };
    } catch (err) {
      return { success: false, models: [], error: cleanError(err, 'Could not load models') };
    }
  }));

  ipcMain.handle('agent:run-command', withIpcErrorHandling('agent:run-command', (event, command) => {
    const win = getWindow();
    const runtimeConfig = readRuntimeConfig();
    return new Promise((resolve) => {
      const lines = [];
      runCommand(
        command,
        (line) => {
          lines.push(line);
          if (win && !win.isDestroyed()) {
            win.webContents.send('cmd:output', { line, command });
          }
        },
        ({ exitCode, timedOut }) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('cmd:done', { command, exitCode, timedOut });
          }
          resolve({ output: lines.join('\n'), exitCode, timedOut });
        },
        runtimeConfig.timeout,
      );
    });
  }));

  ipcMain.handle('run-command', withIpcErrorHandling('run-command', async (event, payload) => {
    // payload may be a plain string (legacy) or { command, cwd }
    const command = typeof payload === 'string' ? payload : payload.command;
    const cwd     = typeof payload === 'string' ? null    : (payload.cwd || null);

    const id = createCommandId();

    // Handle `cd` without spawning a shell — just resolve the path and report back.
    const cdMatch = command.trim().match(/^cd(?:\s+(.+))?$/);
    if (cdMatch) {
      const target = (cdMatch[1] || '').trim();
      try {
        const newCwd = resolveCd(target, cwd);
        // Synthetic lifecycle events so the UI renders the cd card normally.
        event.sender.send('command-start', { id, command: command.trim(), isRunning: true });
        event.sender.send('command-complete', { id, exitCode: 0, newCwd });
        return { success: true, id };
      } catch (err) {
        event.sender.send('command-start', { id, command: command.trim(), isRunning: true });
        event.sender.send('command-stream', { id, type: 'stderr', data: err.message + '\n' });
        event.sender.send('command-complete', { id, exitCode: 1 });
        return { success: true, id };
      }
    }

    streamSpawnedCommand(event, command, id, cwd);
    return { success: true, id };
  }));

  ipcMain.handle('cancel-command', withIpcErrorHandling('cancel-command', async (_event, id) => {
    return cancelActiveCommand(id);
  }));

  ipcMain.handle('tab-complete', withIpcErrorHandling('tab-complete', (_event, { input, cwd }) => {
    const base = cwd || os.homedir();

    // Find the last space to split "command prefix" from "thing being completed".
    // We walk backwards to respect quoted strings like: cat "My File
    const lastSpace = input.lastIndexOf(' ');
    const inputPrefix = lastSpace >= 0 ? input.slice(0, lastSpace + 1) : '';
    const token       = lastSpace >= 0 ? input.slice(lastSpace + 1)    : input;

    // Strip surrounding quotes and trailing separators from the token so
    // path.resolve works cleanly. Handles "New folder"\ → New folder
    const bare = token
      .replace(/[/\\]+$/, '')               // trailing separators
      .replace(/^"(.*)"$/, '$1')            // matching double quotes
      .replace(/^'(.*)'$/, '$1')            // matching single quotes
      .replace(/^["']|["']$/g, '');         // any remaining stray quotes

    // Split the token into the directory portion and partial name.
    const lastSep  = Math.max(bare.lastIndexOf('/'), bare.lastIndexOf('\\'));
    const tokenDir  = lastSep >= 0 ? bare.slice(0, lastSep + 1) : '';
    const tokenName = lastSep >= 0 ? bare.slice(lastSep + 1)    : bare;

    const searchDir = tokenDir ? path.resolve(base, tokenDir) : base;

    try {
      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      const matches = entries
        .filter(e => e.name.toLowerCase().startsWith(tokenName.toLowerCase()))
        .map(e => {
          const isDir  = e.isDirectory();
          const suffix = isDir ? path.sep : '';
          const name   = tokenDir + e.name;
          // For names with spaces, wrap only the name in quotes and put the
          // trailing path separator OUTSIDE the closing quote so it stays valid:
          //   "New folder"\   not   "New folder\"
          const completed = name.includes(' ')
            ? `"${name}"${suffix}`
            : name + suffix;
          return inputPrefix + completed;
        });

      return { success: true, completions: matches };
    } catch {
      return { success: true, completions: [] };
    }
  }));

  ipcMain.handle('agent:list-plugins', withIpcErrorHandling('agent:list-plugins', () => {
    try {
      return { success: true, plugins: pluginManager.listPlugins() };
    } catch (err) {
      return { success: false, plugins: [], error: cleanError(err, 'Could not list plugins') };
    }
  }));

  ipcMain.handle('agent:execute-plugin', withIpcErrorHandling('agent:execute-plugin', async (_event, { name, input, context }) => {
    try {
      const result = await pluginManager.executePlugin(name, input || {}, context || {});

      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('plugin:result', result);
      }

      return result;
    } catch (err) {
      return { success: false, plugin: name, error: cleanError(err, 'Plugin execution failed'), duration: 0 };
    }
  }));

  ipcMain.handle('terminal:start', withIpcErrorHandling('terminal:start', (event, { id, cols, rows, cwd }) => {
    const win = getWindow();
    try {
      const ptyProc = terminalManager.spawn({ id, cols, rows, cwd });

      ptyProc.onData((data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:data', { id, data });
        }
      });

      ptyProc.onExit(({ exitCode, signal }) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('terminal:exit', { id, exitCode, signal });
        }
        terminalManager.kill(id);
      });

      const { shell } = detectShell();
      return { success: true, shell };
    } catch (err) {
      return { success: false, error: cleanError(err, 'Could not start terminal') };
    }
  }));

  ipcMain.on('terminal:input', (_event, { id, data }) => {
    try {
      terminalManager.write(id, data);
    } catch (err) {
      logError('ipc.terminal:input', { error: cleanError(err, 'Could not write to terminal') });
    }
  });

  ipcMain.handle('terminal:resize', withIpcErrorHandling('terminal:resize', (_event, { id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
    return { success: true };
  }));

  ipcMain.handle('terminal:kill', withIpcErrorHandling('terminal:kill', (_event, { id }) => {
    terminalManager.kill(id);
    return { success: true };
  }));

  ipcMain.handle('sessions:load', withIpcErrorHandling('sessions:load', () => readJSON(sessionsFile(), [])));

  ipcMain.handle('sessions:save', withIpcErrorHandling('sessions:save', (_event, session) => {
    const sessions = readJSON(sessionsFile(), []);
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) sessions[idx] = session; else sessions.unshift(session);
    writeJSON(sessionsFile(), sessions.slice(0, 100));
    return { success: true };
  }));

  ipcMain.handle('sessions:delete', withIpcErrorHandling('sessions:delete', (_event, id) => {
    const sessions = readJSON(sessionsFile(), []);
    writeJSON(sessionsFile(), sessions.filter(s => s.id !== id));
    return { success: true };
  }));

  ipcMain.handle('settings:load', withIpcErrorHandling('settings:load', () => {
    return readJSON(settingsFile(), defaultSettings());
  }));

  ipcMain.handle('settings:save', withIpcErrorHandling('settings:save', (_event, prefs) => {
    const current = readJSON(settingsFile(), defaultSettings());
    writeJSON(settingsFile(), { ...current, ...prefs });
    return { success: true };
  }));
}

module.exports = { registerHandlers };
