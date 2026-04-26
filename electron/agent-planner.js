'use strict';

/**
 * Multi-step plan extraction from model output (non-stream planner calls).
 */

const DEFAULT_URL = 'http://localhost:11434';
const { readRuntimeConfig } = require('./runtime-config');

const PLANNER_RULES = `
MULTI-STEP PLANNING (JSON only for this turn):
- If the user task needs several distinct steps, respond with ONLY valid JSON (no prose outside JSON):
  { "plan": [
      { "step": 1, "action": "use_plugin", "plugin": "<name>", "input": { } },
      { "step": 2, "action": "run_command", "command": "ls -la" }
    ] }
- step numbers must be positive integers in order.
- action must be "use_plugin" or "run_command".
- For "use_plugin", include "plugin" (string) and "input" (object).
- For "run_command", include "command" (string). Shell commands are NOT executed automatically; the user must run them from the UI.
- If a single conversational answer is enough, respond with: { "plan": null }
- Do not wrap the JSON in markdown code fences unless necessary; prefer raw JSON.
`;

function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Pull the first JSON object from free-form model text.
 * @param {string} text
 * @returns {object|null}
 */
function parseFirstJSONObject(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  const tryCandidates = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tryCandidates.push(fence[1].trim());
  for (const c of tryCandidates) {
    const j = safeJSON(c);
    if (j && typeof j === 'object') return j;
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return safeJSON(t.slice(start, end + 1));
  }
  return null;
}

/**
 * @param {string} text
 * @returns {object[]|null}  non-null array = steps to run (may be empty); null = parse failure / no plan key → caller uses single-step fallback
 */
function extractPlanFromText(text) {
  const j = parseFirstJSONObject(text);
  if (!j || !Object.prototype.hasOwnProperty.call(j, 'plan')) return null;
  if (j.plan === null) return [];
  if (!Array.isArray(j.plan)) return null;
  return normalizePlan(j.plan);
}

function normalizePlan(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const action = s.action;
    if (action === 'use_plugin' && typeof s.plugin === 'string') {
      out.push({
        step:   Number(s.step) || out.length + 1,
        action: 'use_plugin',
        plugin: s.plugin,
        input:  s.input && typeof s.input === 'object' ? s.input : {},
      });
    } else if (action === 'run_command' && typeof s.command === 'string' && s.command.trim()) {
      out.push({
        step:    Number(s.step) || out.length + 1,
        action:  'run_command',
        command: s.command.trim(),
      });
    }
  }
  return out;
}

function buildReplanPrompt(completed, failed) {
  return `
REPLAN:
Already completed (do not repeat these exact operations): ${JSON.stringify(completed, null, 2)}
Failed steps — do NOT emit an identical step (same action, plugin+input, or command): ${JSON.stringify(failed, null, 2)}
Respond with JSON only: { "plan": [ ... ] } or { "plan": null } if you cannot proceed.`;
}

/**
 * Non-streaming chat completion (Ollama).
 */
async function ollamaCompleteChat({ ollamaUrl = DEFAULT_URL, model, messages, system }) {
  const runtimeConfig = readRuntimeConfig();
  const timeoutMs = Number(runtimeConfig.timeout) > 0 ? Number(runtimeConfig.timeout) : 30_000;
  const url = `${ollamaUrl.replace(/\/$/, '')}/api/chat`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
      options: { temperature: 0.25, num_predict: 1536 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.message?.content || '';
}

module.exports = {
  PLANNER_RULES,
  extractPlanFromText,
  normalizePlan,
  buildReplanPrompt,
  ollamaCompleteChat,
};
