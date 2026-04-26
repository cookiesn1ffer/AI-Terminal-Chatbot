'use strict';

/**
 * electron/terminal.js -- Cross-platform PTY manager using node-pty.
 *
 * Responsibilities:
 *   - Detect the correct shell for the current OS
 *   - Spawn pseudo-terminals (PTYs) with proper environment
 *   - Manage multiple concurrent terminal sessions by ID
 *   - Handle input, output, resize, and clean shutdown
 *
 * Cross-platform shell selection:
 *   Windows  → pwsh.exe (PowerShell Core) → powershell.exe → cmd.exe
 *   macOS    → $SHELL → /bin/zsh → /bin/bash
 *   Linux    → $SHELL → /bin/bash → /bin/sh
 *
 * Windows-specific notes:
 *   - node-pty 1.x uses ConPTY automatically on Windows 10 1903+
 *   - UTF-8 output is requested via PYTHONIOENCODING + chcp 65001
 *   - Paths use backslashes; xterm.js handles display correctly
 */

const os   = require('os');
const fs   = require('fs');
const path = require('path');

// Lazy-load node-pty so the rest of the app still starts if the native
// addon hasn't been compiled yet (guides the user to run electron-rebuild).
let pty = null;
function loadPty() {
  if (pty) return pty;
  try {
    pty = require('node-pty');
    return pty;
  } catch (err) {
    throw new Error(
      'node-pty native module not available.\n' +
      'Run:  npm install && npm run rebuild\n' +
      'Original error: ' + err.message
    );
  }
}

// ── Shell detection ───────────────────────────────────────────────────────────

/**
 * Probe whether an executable exists and is reachable.
 * On Windows we check known locations; on Unix we rely on PATH via `which`.
 */
function exists(bin) {
  try {
    // Direct absolute-path check (fast, works cross-platform)
    fs.accessSync(bin, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function detectShell() {
  const plat = process.platform;

  if (plat === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const candidates = [
      // PowerShell Core (cross-platform, preferred)
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')
        : null,
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      path.join(sysRoot, 'System32', 'cmd.exe'),
    ].filter(Boolean);

    for (const bin of candidates) {
      if (exists(bin)) {
        return { shell: bin, args: [], name: path.basename(bin, '.exe') };
      }
    }
    // Last resort — rely on PATH
    return { shell: 'cmd.exe', args: [], name: 'cmd' };
  }

  // macOS / Linux — respect $SHELL, then common fallbacks
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/sh',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (exists(bin)) {
      return { shell: bin, args: ['--login'], name: path.basename(bin) };
    }
  }

  return { shell: '/bin/sh', args: [], name: 'sh' };
}

// ── Environment setup ─────────────────────────────────────────────────────────

function buildEnv() {
  const env = { ...process.env };

  // Tell terminal emulators we support 256 colours and Unicode
  env.TERM          = 'xterm-256color';
  env.COLORTERM     = 'truecolor';
  env.TERM_PROGRAM  = 'ai-terminal-assistant';

  if (process.platform !== 'win32') {
    // Ensure UTF-8 locale
    if (!env.LANG)   env.LANG   = 'en_US.UTF-8';
    if (!env.LC_ALL) env.LC_ALL = 'en_US.UTF-8';
  } else {
    // Python subprocesses use UTF-8 on Windows
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8       = '1';
  }

  return env;
}

// ── TerminalManager ───────────────────────────────────────────────────────────

class TerminalManager {
  constructor() {
    /** @type {Map<string, import('node-pty').IPty>} */
    this._ptys = new Map();
  }

  /**
   * Spawn a new PTY session.
   *
   * @param {object} opts
   * @param {string}   opts.id   - Unique session identifier
   * @param {number}   opts.cols - Initial columns
   * @param {number}   opts.rows - Initial rows
   * @param {string}  [opts.cwd] - Working directory (defaults to $HOME)
   * @returns {import('node-pty').IPty}
   */
  spawn({ id, cols = 80, rows = 24, cwd }) {
    if (this._ptys.has(id)) {
      this.kill(id);
    }

    const nodePty  = loadPty();
    const { shell, args, name } = detectShell();
    const env      = buildEnv();
    const workdir  = cwd || os.homedir();

    const spawnOpts = {
      name: 'xterm-256color',
      cols,
      rows,
      cwd:  workdir,
      env,
      // On Windows, encoding must be 'utf8' for ConPTY
      ...(process.platform === 'win32' ? { encoding: 'utf8' } : {}),
    };

    const ptyProc = nodePty.spawn(shell, args, spawnOpts);
    this._ptys.set(id, ptyProc);

    return ptyProc;
  }

  /**
   * Write data (keyboard input) to a running PTY.
   *
   * @param {string} id
   * @param {string} data
   */
  write(id, data) {
    const ptyProc = this._ptys.get(id);
    if (ptyProc) {
      try {
        ptyProc.write(data);
      } catch {
        // PTY may have already exited — ignore silently
      }
    }
  }

  /**
   * Resize a running PTY to match new terminal dimensions.
   *
   * @param {string} id
   * @param {number} cols
   * @param {number} rows
   */
  resize(id, cols, rows) {
    const ptyProc = this._ptys.get(id);
    if (!ptyProc || cols < 1 || rows < 1) return;
    try {
      ptyProc.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
      // Ignore — may race with process exit
    }
  }

  /**
   * Kill a PTY session and remove it from the map.
   *
   * @param {string} id
   */
  kill(id) {
    const ptyProc = this._ptys.get(id);
    if (!ptyProc) return;
    try {
      ptyProc.kill();
    } catch {
      // Already gone
    }
    this._ptys.delete(id);
  }

  /** Kill all active sessions (called on app quit). */
  killAll() {
    for (const id of this._ptys.keys()) {
      this.kill(id);
    }
  }

  /** @returns {boolean} */
  has(id) {
    return this._ptys.has(id);
  }
}

// Export a singleton — one manager handles all terminal sessions in the app
const terminalManager = new TerminalManager();
module.exports = { terminalManager, detectShell };
