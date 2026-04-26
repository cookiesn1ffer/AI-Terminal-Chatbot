import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';

/**
 * Terminal.jsx -- Embedded xterm.js terminal backed by a node-pty PTY.
 *
 * Props:
 *   isVisible  {boolean}  - Whether this panel is currently shown.
 *                           Used to trigger a resize after CSS display change.
 *   onReady    {function} - Called when the PTY is successfully started.
 *
 * Ref methods (exposed via forwardRef):
 *   runCommand(cmd: string) - Inject a command string and press Enter.
 *                             Called by App.jsx when the user clicks
 *                             "Run in Terminal" on a chat command block.
 *
 * Architecture:
 *   - xterm.js Terminal renders in a div (containerRef)
 *   - FitAddon sizes the terminal to its container automatically
 *   - ResizeObserver triggers fit() + IPC resize whenever the container changes
 *   - All PTY ↔ renderer communication goes through window.terminalAPI
 *     (defined in preload.js, backed by ipc-handlers.js + terminal.js)
 *
 * Cross-platform notes:
 *   - xterm.js handles ANSI escape codes natively on all platforms
 *   - Windows ConPTY + PowerShell return CRLF — xterm handles this correctly
 *   - We send '\r' (CR) for Enter, which works on both Unix (\r → LF) and
 *     Windows ConPTY (expects CR)
 */

// ── Unique session ID for this terminal instance ──────────────────────────────
const TERM_ID = 'main-terminal';

// ── xterm.js theme matching the app's dark palette ───────────────────────────
const XTERM_THEME = {
  background:    '#0a0a0a',
  foreground:    '#e2e8f0',
  cursor:        '#60a5fa',
  cursorAccent:  '#0a0a0a',
  selectionBackground: 'rgba(59, 130, 246, 0.3)',
  black:         '#1a1a1a',
  red:           '#f87171',
  green:         '#4ade80',
  yellow:        '#facc15',
  blue:          '#60a5fa',
  magenta:       '#c084fc',
  cyan:          '#34d399',
  white:         '#e2e8f0',
  brightBlack:   '#374151',
  brightRed:     '#fca5a5',
  brightGreen:   '#86efac',
  brightYellow:  '#fde047',
  brightBlue:    '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan:    '#6ee7b7',
  brightWhite:   '#f9fafb',
};

const TerminalComponent = forwardRef(function TerminalComponent(
  { isVisible = true, onReady },
  ref
) {
  const containerRef = useRef(null);
  const xtermRef     = useRef(null);   // xterm.js Terminal instance
  const fitRef       = useRef(null);   // FitAddon instance
  const readyRef     = useRef(false);  // PTY successfully started

  // ── Public API (called by parent via ref) ─────────────────────────────────

  useImperativeHandle(ref, () => ({
    /**
     * Inject a shell command into the terminal exactly as if the user typed it.
     * Uses '\r' so it works on both Windows (ConPTY) and Unix PTYs.
     */
    runCommand(cmd) {
      if (!readyRef.current) return;
      window.terminalAPI.sendInput(TERM_ID, cmd + '\r');
    },

    /** Programmatically paste text without adding a newline. */
    paste(text) {
      if (!readyRef.current) return;
      window.terminalAPI.sendInput(TERM_ID, text);
    },
  }), []);

  // ── Initialise xterm + PTY (runs once on mount) ───────────────────────────

  useEffect(() => {
    let disposed = false;

    // Dynamic imports — xterm is a dev/renderer dependency bundled by webpack.
    // Importing here (not top-level) keeps things clean and avoids SSR issues.
    Promise.all([
      import('xterm').then(m => m.Terminal),
      import('xterm-addon-fit').then(m => m.FitAddon),
      import('xterm/css/xterm.css'),
    ]).then(([Terminal, FitAddon]) => {
      if (disposed || !containerRef.current) return;

      // ── Create xterm.js Terminal ──────────────────────────────────────────
      const term = new Terminal({
        cursorBlink:        true,
        cursorStyle:        'block',
        fontSize:           13,
        lineHeight:         1.25,
        fontFamily:         "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
        fontWeight:         '400',
        letterSpacing:      0,
        theme:              XTERM_THEME,
        scrollback:         5000,
        allowTransparency:  false,
        convertEol:         false,  // PTY handles line endings — don't double-convert
        drawBoldTextInBrightColors: true,
        windowsMode:        process.platform === 'win32',
        // windowsMode makes xterm handle CRLF output from ConPTY correctly
      });

      // ── Fit addon: keeps cols/rows in sync with CSS dimensions ───────────
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // ── Mount into DOM ────────────────────────────────────────────────────
      term.open(containerRef.current);
      fitAddon.fit();

      xtermRef.current = term;
      fitRef.current   = fitAddon;

      // ── Spawn PTY in main process ─────────────────────────────────────────
      window.terminalAPI.start({
        id:   TERM_ID,
        cols: term.cols,
        rows: term.rows,
      }).then(({ success, shell, error }) => {
        if (disposed) return;

        if (!success) {
          term.writeln('\r\n\x1b[1;31m✗ Terminal failed to start\x1b[0m');
          term.writeln('\x1b[33m' + (error || 'Unknown error') + '\x1b[0m');
          term.writeln('');
          term.writeln('\x1b[2mIf node-pty is missing, run:\x1b[0m');
          term.writeln('\x1b[36m  npm install && npm run rebuild  (runs electron-rebuild)\x1b[0m');
          return;
        }

        readyRef.current = true;
        onReady?.({ shell });
      });

      // ── PTY → xterm: stream output ────────────────────────────────────────
      window.terminalAPI.onData(({ id, data }) => {
        if (id === TERM_ID && !disposed) {
          term.write(data);
        }
      });

      // ── PTY exit notification ─────────────────────────────────────────────
      window.terminalAPI.onExit(({ id, exitCode }) => {
        if (id !== TERM_ID || disposed) return;
        readyRef.current = false;
        term.writeln('\r\n');
        term.writeln('\x1b[2m─────────────────────────────────\x1b[0m');
        term.writeln(
          exitCode === 0
            ? '\x1b[32m[Process exited cleanly]\x1b[0m'
            : `\x1b[31m[Process exited with code ${exitCode}]\x1b[0m`
        );
      });

      // ── xterm → PTY: keyboard input ───────────────────────────────────────
      // xterm.js fires onData for every key the user presses.
      // We forward it verbatim — the PTY handles line editing, history, etc.
      term.onData((data) => {
        if (readyRef.current) {
          window.terminalAPI.sendInput(TERM_ID, data);
        }
      });

      // ── Resize: observe container dimensions ──────────────────────────────
      // ResizeObserver fires whenever the container's CSS size changes
      // (window resize, panel toggle, sidebar expand, etc.)
      const resizeObserver = new ResizeObserver(() => {
        if (disposed || !fitRef.current) return;
        try {
          fitAddon.fit();
          window.terminalAPI.resize(TERM_ID, term.cols, term.rows);
        } catch {
          // Ignore transient errors during rapid resizes
        }
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // Store for cleanup
      xtermRef.current._resizeObserver = resizeObserver;

    }).catch(err => {
      console.error('[Terminal] Failed to load xterm:', err);
    });

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    return () => {
      disposed = true;
      readyRef.current = false;

      // Remove IPC listeners first to stop data arriving after cleanup
      window.terminalAPI.clearListeners();

      // Kill the PTY process
      window.terminalAPI.kill(TERM_ID).catch(() => {});

      // Disconnect resize observer
      const observer = xtermRef.current?._resizeObserver;
      if (observer) observer.disconnect();

      // Dispose xterm instance
      if (xtermRef.current) {
        try { xtermRef.current.dispose(); } catch {}
        xtermRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fit when the panel becomes visible ────────────────────────────────
  // When the user switches from Chat → Terminal tab, the container goes from
  // display:none to display:flex.  The ResizeObserver fires, but we also
  // do a manual fit with a small delay to let the layout settle.

  const triggerFit = useCallback(() => {
    const timer = setTimeout(() => {
      if (!fitRef.current || !xtermRef.current) return;
      try {
        fitRef.current.fit();
        window.terminalAPI.resize(
          TERM_ID,
          xtermRef.current.cols,
          xtermRef.current.rows
        );
      } catch {}
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isVisible) return triggerFit();
  }, [isVisible, triggerFit]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full bg-[#0a0a0a]">
      {/* xterm.js mounts here — must be a plain div with no padding/margin
          so FitAddon can measure the exact available pixel area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '6px 8px' }}
      />
    </div>
  );
});

export default TerminalComponent;
