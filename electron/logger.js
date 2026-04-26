'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureLogFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }
}

function stringifyMeta(meta) {
  if (!meta) return '';
  try {
    return ' ' + JSON.stringify(meta);
  } catch {
    return ' ' + String(meta);
  }
}

function writeLog(level, message, meta) {
  try {
    ensureLogFile();
    const line = `[${new Date().toISOString()}] [${level}] ${message}${stringifyMeta(meta)}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Logging should never break app execution.
  }
}

function logInfo(message, meta) {
  writeLog('INFO', message, meta);
}

function logError(message, meta) {
  writeLog('ERROR', message, meta);
}

module.exports = {
  LOG_FILE,
  logInfo,
  logError,
};
