'use strict';

/**
 * src/plugins/pluginManager.js -- Plugin loader and executor (foundation).
 *
 * Scans this directory for *.js plugin modules, validates the shared interface,
 * and exposes listPlugins / executePlugin.
 *
 * Plugin modules (every *.js here except this file) must export:
 *   {
 *     name:        string,
 *     description: string,
 *     parameters?: object,
 *     execute:     async (input, context) => any
 *   }
 *
 * Intended for Node (e.g. Electron main). Do not import from the webpacked
 * renderer bundle without a bundler-specific loader.
 */

const fs   = require('fs');
const path = require('path');

/** Directory that holds plugin modules (same folder as this file). */
const PLUGINS_DIR = __dirname;

const MANAGER_FILENAME = 'pluginManager.js';

const REQUIRED_FIELDS = ['name', 'description', 'execute'];

class PluginManager {
  constructor() {
    /** @type {Map<string, object>} */
    this._plugins = new Map();
    this._loaded = false;
  }

  /**
   * Load or reload every *.js plugin in PLUGINS_DIR (except this manager file).
   */
  load() {
    this._plugins.clear();

    if (!fs.existsSync(PLUGINS_DIR)) {
      console.warn(`[src/plugins/pluginManager] directory missing: ${PLUGINS_DIR}`);
      this._loaded = true;
      return;
    }

    const files = fs
      .readdirSync(PLUGINS_DIR)
      .filter(f => f.endsWith('.js') && f !== MANAGER_FILENAME)
      .sort();

    for (const file of files) {
      const filePath = path.join(PLUGINS_DIR, file);
      try {
        delete require.cache[require.resolve(filePath)];
        const plugin = require(filePath);

        const missing = REQUIRED_FIELDS.filter(k => !(k in plugin));
        if (missing.length > 0) {
          console.warn(
            `[src/plugins/pluginManager] Skip ${file}: missing [${missing.join(', ')}]`,
          );
          continue;
        }

        if (typeof plugin.execute !== 'function') {
          console.warn(`[src/plugins/pluginManager] Skip ${file}: execute must be a function`);
          continue;
        }

        if (this._plugins.has(plugin.name)) {
          console.warn(
            `[src/plugins/pluginManager] Duplicate name "${plugin.name}" in ${file} — skip`,
          );
          continue;
        }

        this._plugins.set(plugin.name, plugin);
        console.log(`[src/plugins/pluginManager] Loaded: ${plugin.name} (${file})`);
      } catch (err) {
        console.error(`[src/plugins/pluginManager] Failed ${file}:`, err.message);
      }
    }

    this._loaded = true;
    console.log(`[src/plugins/pluginManager] ${this._plugins.size} plugin(s) ready.`);
  }

  /**
   * @returns {{ name: string, description: string, parameters: object }[]}
   */
  listPlugins() {
    if (!this._loaded) this.load();
    return Array.from(this._plugins.values()).map(p => ({
      name:        p.name,
      description: p.description,
      parameters:  p.parameters || {},
    }));
  }

  /**
   * @param {string} name
   * @param {object} [input]
   * @returns {Promise<{ success: boolean, plugin: string, data?: any, duration: number, error?: string }>}
   */
  async executePlugin(name, input = {}) {
    if (!this._loaded) this.load();

    const plugin = this._plugins.get(name);
    if (!plugin) {
      return {
        success:  false,
        plugin:   name,
        error:    `No plugin named "${name}". Loaded: ${[...this._plugins.keys()].join(', ') || 'none'}`,
        duration: 0,
      };
    }

    const start = Date.now();
    try {
      const data = await plugin.execute(input, {});
      const duration = Date.now() - start;
      console.log(`[src/plugins/pluginManager] ${name} ok in ${duration}ms`);
      return { success: true, plugin: name, data, duration };
    } catch (err) {
      const duration = Date.now() - start;
      console.error(`[src/plugins/pluginManager] ${name} error after ${duration}ms:`, err.message);
      return {
        success:  false,
        plugin:   name,
        error:    err.message || String(err),
        duration,
      };
    }
  }
}

const pluginManager = new PluginManager();
pluginManager.load();

module.exports = { pluginManager };
