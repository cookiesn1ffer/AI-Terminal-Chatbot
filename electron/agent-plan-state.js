'use strict';

/**
 * In-memory state for one assistant message run (multi-step plan execution).
 */

function createRun() {
  return {
    current_plan:         [],
    current_step_index:   0,
    completed:            [],
    failed:               [],
  };
}

/** @type {Map<string, ReturnType<typeof createRun>>} */
const runs = new Map();

function start(messageId) {
  const run = createRun();
  runs.set(String(messageId), run);
  return run;
}

function get(messageId) {
  return runs.get(String(messageId));
}

function clear(messageId) {
  runs.delete(String(messageId));
}

module.exports = { start, get, clear, createRun };
