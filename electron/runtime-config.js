'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'settings.json');

const DEFAULT_CONFIG = {
  model: 'mistral',
  timeout: 30000,
  max_output: 65536,
};

function readRuntimeConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  readRuntimeConfig,
};
