'use strict';

/**
 * electron/pluginManager.js -- Plugin loader and executor.
 *
 * Responsibilities:
 *   - Eagerly load all *.js files from src/plugins/
 *   - Validate each plugin against the required interface
 *   - Expose listPlugins() and executePlugin() to IPC handlers
 *
 * Plugin interface (each plugin module must export):
 *   {
 *     name:        string,           // unique kebab-case identifier
 *     description: string,           // one-sentence summary for the LLM
 *     parameters:  object,           // JSON Schema describing accepted input
 *     execute:     async (input, context) => any
 *   }
 */

const fs   = require('fs');
const path = require('path');
const { readRuntimeConfig } = require('./runtime-config');
const { logInfo, logError } = require('./logger');

// Plugins live in src/plugins/ relative to this file (electron/)
const PLUGINS_DIR = path.resolve(__dirname, '..', 'src', 'plugins');

// Required fields every plugin module must export
const REQUIRED_FIELDS = ['name', 'description', 'execute'];

class PluginManager {
  constructor() {
    /** @type {Map<string, object>} name -> plugin module */
    this._plugins = new Map();
    this._loaded  = false;
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  /**
   * Scan PLUGINS_DIR and load all valid *.js plugin modules.
   * Called once at startup. Safe to call again to hot-reload.
   */
  load() {
    this._plugins.clear();

    if (!fs.existsSync(PLUGINS_DIR)) {
      console.warn(`[PluginManager] plugins directory not found: ${PLUGINS_DIR}`);
      this._loaded = true;
      return;
    }

    // Exclude any file named pluginManager.js — it's a manager, not a plugin
    const EXCLUDED = new Set(['pluginManager.js']);

    const files = fs.readdirSync(PLUGINS_DIR)
      .filter(f => f.endsWith('.js') && !EXCLUDED.has(f))
      .sort();

    for (const file of files) {
      const filePath = path.join(PLUGINS_DIR, file);
      try {
        // Clear require cache to support hot-reload
        delete require.cache[require.resolve(filePath)];
        const plugin = require(filePath);

        const missing = REQUIRED_FIELDS.filter(k => !(k in plugin));
        if (missing.length > 0) {
          console.warn(`[PluginManager] Skipping ${file}: missing fields [${missing.join(', ')}]`);
          continue;
        }

        if (typeof plugin.execute !== 'function') {
          console.warn(`[PluginManager] Skipping ${file}: execute must be a function`);
          continue;
        }

        if (this._plugins.has(plugin.name)) {
          console.warn(`[PluginManager] Duplicate plugin name "${plugin.name}" in ${file} -- skipping`);
          continue;
        }

        this._plugins.set(plugin.name, plugin);
        console.log(`[PluginManager] Loaded plugin: ${plugin.name} (${file})`);

      } catch (err) {
        console.error(`[PluginManager] Failed to load ${file}:`, err.message);
      }
    }

    this._loaded = true;
    console.log(`[PluginManager] ${this._plugins.size} plugin(s) ready.`);
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  /**
   * Returns true if a plugin with the given name is loaded.
   * @param {string} name
   */
  has(name) {
    return this._plugins.has(name);
  }

  /**
   * Return an array of plugin metadata objects (no execute function).
   * Safe to serialise to JSON and send to the renderer.
   *
   * @returns {{ name: string, description: string, parameters?: object }[]}
   */
  listPlugins() {
    return Array.from(this._plugins.values()).map(p => ({
      name:        p.name,
      description: p.description,
      parameters:  p.parameters || {},
    }));
  }

  // --------------------------------------------------------------------------
  // Execution
  // --------------------------------------------------------------------------

  /**
   * Execute a named plugin and return a structured result.
   *
   * @param {string} name     - Plugin name (must match plugin.name)
   * @param {object} input    - Input object forwarded to plugin.execute()
   * @param {object} context  - Optional execution context (cwd, settings, etc.)
   *
   * @returns {Promise<{
   *   success:   boolean,
   *   plugin:    string,
   *   data?:     any,
   *   duration:  number,   // ms
   *   error?:    string,
   * }>}
   */
  async executePlugin(name, input = {}, context = {}) {
    if (!this._loaded) this.load();

    const plugin = this._plugins.get(name);

    if (!plugin) {
      return {
        success: false,
        plugin:  name,
        error:   `No plugin named "${name}" is loaded. Available: ${[...this._plugins.keys()].join(', ') || 'none'}`,
        duration: 0,
      };
    }

    const start = Date.now();
    const runtimeConfig = readRuntimeConfig();
    const timeoutMs = Number(runtimeConfig.timeout) > 0 ? Number(runtimeConfig.timeout) : 30_000;

    try {
      logInfo('plugin.start', { plugin: name, input });
      const data = await Promise.race([
        plugin.execute(input, context),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Plugin timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      const duration = Date.now() - start;

      console.log(`[PluginManager] ${name} executed in ${duration}ms`);
      logInfo('plugin.finish', { plugin: name, duration, success: true });

      return { success: true, plugin: name, data, duration };

    } catch (err) {
      const duration = Date.now() - start;
      console.error(`[PluginManager] ${name} threw after ${duration}ms:`, err.message);
      logError('plugin.error', { plugin: name, duration, error: err.message, input });

      return {
        success:  false,
        plugin:   name,
        error:    err.message || String(err),
        duration,
      };
    }
  }
}

// Singleton — loaded eagerly at require() time
const pluginManager = new PluginManager();
pluginManager.load();

module.exports = { pluginManager };
