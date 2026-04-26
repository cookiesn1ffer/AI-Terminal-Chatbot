'use strict';

/**
 * command-runner.js -- Safe shell command execution.
 *
 * Runs commands via child_process.spawn (not shell=true by default).
 * Streams output lines back to the caller.
 *
 * Safety constraints:
 *  - Hard timeout (default 30 s) kills the process automatically.
 *  - Uses spawn with shell:true (required for pipes/redirects) but the
 *    command is only ever executed after the user explicitly clicks "Run".
 *  - Output is capped at MAX_OUTPUT_BYTES to prevent memory exhaustion.
 */

const { spawn } = require('child_process');
const { readRuntimeConfig } = require('./runtime-config');
const { logInfo, logError } = require('./logger');

const FALLBACK_MAX_OUTPUT_BYTES = 64 * 1024;
const FALLBACK_TIMEOUT = 30_000;

/**
 * Execute a shell command and stream its output.
 *
 * @param {string}   command    - The shell command to execute
 * @param {function} onLine     - Called with each stdout/stderr line
 * @param {function} onDone     - Called with { exitCode, timedOut } when finished
 * @param {number}   [timeout]  - Timeout in ms (default 30 000)
 */
function runCommand(command, onLine, onDone, timeout = FALLBACK_TIMEOUT) {
  const runtimeConfig = readRuntimeConfig();
  const maxOutputBytes = Number(runtimeConfig.max_output) > 0
    ? Number(runtimeConfig.max_output)
    : FALLBACK_MAX_OUTPUT_BYTES;
  const safeTimeout = Number(timeout) > 0
    ? Number(timeout)
    : (Number(runtimeConfig.timeout) > 0 ? Number(runtimeConfig.timeout) : FALLBACK_TIMEOUT);

  let outputBytes = 0;
  let capped      = false;
  let timedOut    = false;

  logInfo('command.start', { command, timeout: safeTimeout, maxOutputBytes });

  const proc = spawn(command, [], {
    shell: true,
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env },
  });

  const handleData = (data) => {
    if (capped) return;
    outputBytes += data.length;

    if (outputBytes > maxOutputBytes) {
      capped = true;
      onLine(`\n[Output truncated — exceeded ${Math.round(maxOutputBytes / 1024)} KB limit]`);
      proc.kill('SIGTERM');
      return;
    }

    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line) onLine(line);
    }
  };

  proc.stdout.on('data', handleData);
  proc.stderr.on('data', handleData);

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
    onLine('\n[Command timed out after ' + (safeTimeout / 1000) + 's]');
    logError('command.timeout', { command, timeout: safeTimeout });
  }, safeTimeout);

  proc.on('close', (exitCode) => {
    clearTimeout(timer);
    logInfo('command.finish', {
      command,
      exitCode: exitCode ?? -1,
      timedOut,
      capped,
      outputBytes,
    });
    onDone({ exitCode: exitCode ?? -1, timedOut });
  });

  proc.on('error', (err) => {
    clearTimeout(timer);
    onLine(`[Execution error: ${err.message}]`);
    logError('command.error', { command, error: err.message });
    onDone({ exitCode: -1, timedOut: false });
  });
}

module.exports = { runCommand };
