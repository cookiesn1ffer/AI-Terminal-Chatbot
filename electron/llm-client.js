'use strict';

/**
 * llm-client.js -- Thin wrapper around the Ollama HTTP API.
 *
 * Uses Node.js 18+ built-in fetch (available in Electron 28+).
 * Supports streaming via an onToken callback.
 */

const DEFAULT_URL = 'http://localhost:11434';
const { readRuntimeConfig } = require('./runtime-config');

/**
 * Stream a chat completion from Ollama.
 *
 * @param {object} opts
 * @param {string}   opts.ollamaUrl   - Base URL  (e.g. "http://localhost:11434")
 * @param {string}   opts.model       - Model name (e.g. "mistral")
 * @param {object[]} opts.messages    - [{role, content}, ...]
 * @param {string}   opts.system      - System prompt (prepended automatically)
 * @param {function} opts.onToken     - Called with each streamed string token
 * @returns {Promise<string>}          Full assembled response
 */
async function streamChat({ ollamaUrl = DEFAULT_URL, model, messages, system, onToken }) {
  const runtimeConfig = readRuntimeConfig();
  const timeoutMs = Number(runtimeConfig.timeout) > 0 ? Number(runtimeConfig.timeout) : 30_000;
  const url = `${ollamaUrl.replace(/\/$/, '')}/api/chat`;

  const body = {
    model,
    stream: true,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ],
    options: {
      temperature: 0.3,
      num_predict: 2048,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}: ${await res.text()}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });

    // Ollama streams NDJSON — one JSON object per line
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const data = JSON.parse(trimmed);
        const token = data?.message?.content ?? '';
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // Incomplete JSON fragment — skip, will be completed in next chunk
      }
    }
  }

  return full;
}

/**
 * List all models installed in Ollama.
 *
 * @param {string} ollamaUrl
 * @returns {Promise<string[]>} Array of model names
 */
async function listModels(ollamaUrl = DEFAULT_URL) {
  const runtimeConfig = readRuntimeConfig();
  const timeoutMs = Number(runtimeConfig.timeout) > 0 ? Math.min(Number(runtimeConfig.timeout), 8000) : 8000;
  const url = `${ollamaUrl.replace(/\/$/, '')}/api/tags`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map(m => m.name);
}

/**
 * Check whether Ollama is reachable.
 *
 * @param {string} ollamaUrl
 * @returns {Promise<boolean>}
 */
async function ping(ollamaUrl = DEFAULT_URL) {
  const runtimeConfig = readRuntimeConfig();
  const timeoutMs = Number(runtimeConfig.timeout) > 0 ? Math.min(Number(runtimeConfig.timeout), 4000) : 4000;
  try {
    await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { streamChat, listModels, ping };
