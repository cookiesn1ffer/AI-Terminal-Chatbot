'use strict';

/**
 * Agent controller: optional multi-step plan execution, then single-step LLM fallback.
 */

const { streamChat } = require('./llm-client');
const { runCommand } = require('./command-runner');
const { buildSystemPrompt } = require('./agent/decision-layer');
const memoryManager = require('./agent/memoryManager');
const { pluginManager } = require('./pluginManager');
const agentPlanState = require('./agent-plan-state');
const {
  PLANNER_RULES,
  extractPlanFromText,
  buildReplanPrompt,
  ollamaCompleteChat,
} = require('./agent-planner');
const { readRuntimeConfig } = require('./runtime-config');
const { logError } = require('./logger');

const MAX_CONTEXT   = 20;
const REPLAN_LIMIT  = 2;
const MAX_PLAN_STEPS = 12;

// ── Single-step: use_plugin JSON (full assistant reply) ──────────────────────

function safeJSONParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function tryParseUsePluginAction(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  const candidates = [];
  const direct = safeJSONParse(text);
  if (direct) candidates.push(direct);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = safeJSONParse(fence[1].trim());
    if (inner) candidates.push(inner);
  }
  for (const j of candidates) {
    if (j && j.action === 'use_plugin' && typeof j.plugin === 'string') {
      return {
        plugin:          j.plugin,
        input:           j.input && typeof j.input === 'object' ? j.input : {},
        fallbackCommand: typeof j.fallbackCommand === 'string' ? j.fallbackCommand : '',
      };
    }
  }
  return null;
}

function analyzePluginExecutionResult(execResult) {
  if (!execResult || !execResult.success) {
    return `Plugin failed: ${(execResult && execResult.error) || 'unknown error'}`;
  }
  const d = execResult.data;
  if (d && typeof d === 'object' && d.error) {
    return `Plugin returned error field: ${d.error}`;
  }
  try {
    const s = JSON.stringify(d);
    return s.length > 600 ? `${s.slice(0, 600)}…` : s;
  } catch {
    return 'Result could not be serialized for analysis.';
  }
}

function emitPluginAsCommandOutput(win, plugin, execResult) {
  if (!win || win.isDestroyed()) return;
  const label   = `[plugin:${plugin}]`;
  const payload = execResult.success
    ? JSON.stringify(execResult.data ?? {}, null, 2)
    : JSON.stringify({ error: execResult.error || 'unknown' }, null, 2);
  for (const line of payload.split('\n')) {
    win.webContents.send('cmd:output', { line: line.length ? line : ' ', command: label });
  }
  win.webContents.send('cmd:done', {
    command:  label,
    exitCode: execResult.success ? 0 : 1,
    timedOut: false,
  });
}

function buildPluginAppendix(plugin, input, execResult, fallbackShellText) {
  const analysis = analyzePluginExecutionResult(execResult);
  const summaryBlock = {
    plugin,
    input,
    success:  execResult.success,
    data:     execResult.data,
    error:    execResult.error,
    duration: execResult.duration,
  };
  return (
    '\n\n---\n**Plugin run:** `' +
    plugin +
    '`\n\n**Analyzer:**\n' +
    analysis +
    '\n\n**Structured result:**\n```json\n' +
    JSON.stringify(summaryBlock, null, 2) +
    '\n```' +
    (fallbackShellText || '')
  );
}

function stepFingerprint(step) {
  return JSON.stringify({
    a: step.action,
    p: step.plugin,
    i: step.input,
    c: step.command,
  });
}

function describeStepAction(step) {
  if (!step || typeof step !== 'object') return 'unknown_action';
  if (step.action === 'use_plugin') {
    return `use_plugin:${step.plugin || 'unknown'}`;
  }
  if (step.action === 'run_command') {
    return `run_command:${step.command || ''}`.trim();
  }
  return step.action || 'unknown_action';
}

function buildPlannerMemoryContext(memorySummary) {
  return (
    'LONG_TERM_MEMORY:\n' +
    JSON.stringify(memorySummary || { recent_successes: [], recent_failures: [] }, null, 2) +
    '\nUse this memory to avoid repeating recent failures and to prefer approaches that have succeeded before.'
  );
}

async function safeAddSuccessfulAction(action) {
  try {
    await memoryManager.addSuccessfulAction(action);
  } catch (err) {
    console.warn('[Agent] failed to persist successful action:', err.message);
  }
}

async function safeAddFailedAction(action) {
  try {
    await memoryManager.addFailedAction(action);
  } catch (err) {
    console.warn('[Agent] failed to persist failed action:', err.message);
  }
}

async function safeAddObservation(note) {
  try {
    await memoryManager.addObservation(note);
  } catch (err) {
    console.warn('[Agent] failed to persist observation:', err.message);
  }
}

async function appendUsePluginFromFullReply({ win, messageId, full }) {
  let finalContent = full;
  const usePlugin = tryParseUsePluginAction(full);
  if (!usePlugin || !win || win.isDestroyed()) return finalContent;

  const { plugin, input, fallbackCommand } = usePlugin;
  let execResult = await pluginManager.executePlugin(plugin, input || {}, {
    cwd: process.cwd(),
  });

  console.log('[Agent] plugin execution', { plugin, input, output: execResult });
  emitPluginAsCommandOutput(win, plugin, execResult);

  let fallbackShellText = '';
  if (!execResult.success && fallbackCommand.trim()) {
    const fc = fallbackCommand.trim();
    const fbLines = [];
    await new Promise((resolve) => {
      runCommand(
        fc,
        (line) => {
          fbLines.push(line);
          if (win && !win.isDestroyed()) {
            win.webContents.send('cmd:output', { line, command: fc });
          }
        },
        ({ exitCode, timedOut }) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send('cmd:done', { command: fc, exitCode, timedOut });
          }
          fallbackShellText =
            '\n\n**Fallback shell (`' +
            fc +
            '`):**\n```\n' +
            fbLines.join('\n') +
            '\n```\n';
          resolve();
        },
      );
    });
  }

  const appendix = buildPluginAppendix(plugin, input, execResult, fallbackShellText);
  finalContent = full + appendix;
  win.webContents.send('stream:token', { token: appendix, messageId });
  return finalContent;
}

/**
 * @param {{ getWindow: () => import('electron').BrowserWindow|null, messages: object[], settings: object, messageId: string }} opts
 */
async function runAgentMessage(opts) {
  const { getWindow, messages, settings, messageId } = opts;
  const win = getWindow();
  const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
  const runtimeConfig = readRuntimeConfig();
  const model     = settings.model || runtimeConfig.model || 'mistral';
  const systemPrompt = buildSystemPrompt(messages, settings);
  const context = messages.slice(-MAX_CONTEXT).map(m => ({
    role:    m.role,
    content: m.content,
  }));

  let transcript = '';
  const send = (token) => {
    transcript += token;
    if (win && !win.isDestroyed()) {
      win.webContents.send('stream:token', { token, messageId });
    }
  };

  const planState = agentPlanState.start(messageId);
  try {

  let memorySummary = { recent_successes: [], recent_failures: [] };
  try {
    memorySummary = await memoryManager.getSummary();
  } catch (err) {
    console.warn('[Agent] memory summary unavailable, continuing without it:', err.message);
  }

  const plannerMemoryContext = buildPlannerMemoryContext(memorySummary);

  let plannedSteps = null;
  try {
    const planRaw = await ollamaCompleteChat({
      ollamaUrl,
      model,
      system: systemPrompt + '\n\n' + plannerMemoryContext + '\n\n' + PLANNER_RULES,
      messages: context,
    });
    plannedSteps = extractPlanFromText(planRaw || '');
    if (Array.isArray(plannedSteps) && plannedSteps.length > MAX_PLAN_STEPS) {
      plannedSteps = plannedSteps.slice(0, MAX_PLAN_STEPS);
      await safeAddObservation(`Plan truncated to ${MAX_PLAN_STEPS} steps for stability.`);
    }
  } catch (err) {
    console.warn('[Agent] planner call failed, using single-step flow:', err.message);
    logError('agent.planner_error', { error: err.message, messageId });
    plannedSteps = null;
  }

  // null = could not parse plan object → single-step; [] = explicit no plan → single-step
  const useMultiStep = Array.isArray(plannedSteps) && plannedSteps.length > 0;

  if (useMultiStep) {
    planState.current_plan       = plannedSteps;
    planState.current_step_index = 0;

    send(`## Multi-step plan (${plannedSteps.length} steps)\n\n`);

    let replansUsed = 0;

    while (planState.current_step_index < planState.current_plan.length) {
      const step = planState.current_plan[planState.current_step_index];
      const fp   = stepFingerprint(step);

      if (planState.failed.some(f => f.fingerprint === fp)) {
        send(`\n*Skipping a step that already failed with the same definition — replanning.*\n`);
        if (replansUsed >= REPLAN_LIMIT) {
          send(`\n*Replan limit reached; stopping multi-step run.*\n`);
          break;
        }
        replansUsed++;
        try {
          const replanRaw = await ollamaCompleteChat({
            ollamaUrl,
            model,
            system:
              systemPrompt +
              '\n\n' +
              plannerMemoryContext +
              '\n\n' +
              PLANNER_RULES +
              '\n\n' +
              buildReplanPrompt(planState.completed, planState.failed),
            messages: context,
          });
          const newPlan = extractPlanFromText(replanRaw || '');
          if (!newPlan || newPlan.length === 0) {
            send(`\n*No revised plan returned; stopping.*\n`);
            break;
          }
          planState.current_plan       = newPlan;
          planState.current_step_index = 0;
          send(`\n*Updated plan (${newPlan.length} steps).*\n\n`);
        } catch (e) {
          send(`\n*Replan request failed: ${e.message}*\n`);
          break;
        }
        continue;
      }

      if (step.action === 'use_plugin') {
        send(`\n**Step ${step.step}** — plugin \`${step.plugin}\`\n`);
        let execResult = await pluginManager.executePlugin(step.plugin, step.input || {}, {
          cwd: process.cwd(),
        });
        console.log('[Agent] plan step', {
          step: step.step,
          plugin: step.plugin,
          input: step.input,
          output: execResult,
        });
        emitPluginAsCommandOutput(win, step.plugin, execResult);

        const dataErr =
          execResult.success &&
          execResult.data &&
          typeof execResult.data === 'object' &&
          execResult.data.error;

        if (!execResult.success || dataErr) {
          await safeAddFailedAction(describeStepAction(step));
          planState.failed.push({
            step:        step.step,
            action:      step.action,
            plugin:      step.plugin,
            input:       step.input,
            fingerprint: fp,
            error:       execResult.error || (dataErr ? execResult.data.error : 'plugin_error'),
          });
          const appendix = buildPluginAppendix(
            step.plugin,
            step.input,
            execResult,
            '',
          );
          send(appendix);
          await safeAddObservation(
            `Plugin step failed: ${step.plugin} - ${execResult.error || (dataErr ? execResult.data.error : 'plugin_error')}`,
          );

          if (replansUsed >= REPLAN_LIMIT) {
            send(`\n*Step failed; replan limit reached. Skipping ahead.*\n`);
            planState.current_step_index++;
            continue;
          }
          replansUsed++;
          try {
            const replanRaw = await ollamaCompleteChat({
              ollamaUrl,
              model,
              system:
                systemPrompt +
                '\n\n' +
                plannerMemoryContext +
                '\n\n' +
                PLANNER_RULES +
                '\n\n' +
                buildReplanPrompt(planState.completed, planState.failed),
              messages: context,
            });
            const newPlan = extractPlanFromText(replanRaw || '');
            if (!newPlan || newPlan.length === 0) {
              send(`\n*No revised plan; continuing with remaining steps if any.*\n`);
              planState.current_step_index++;
              continue;
            }
            planState.current_plan       = newPlan;
            planState.current_step_index = 0;
            send(`\n*Revised plan (${newPlan.length} steps).*\n\n`);
          } catch (e) {
            send(`\n*Replan failed: ${e.message}*\n`);
            planState.current_step_index++;
          }
          continue;
        }

        await safeAddSuccessfulAction(describeStepAction(step));
        planState.completed.push({
          step:        step.step,
          action:      'use_plugin',
          plugin:      step.plugin,
          fingerprint: fp,
          result:      execResult.data,
        });
        send(buildPluginAppendix(step.plugin, step.input, execResult, ''));
        planState.current_step_index++;
        continue;
      }

      if (step.action === 'run_command') {
        await safeAddSuccessfulAction(describeStepAction(step));
        send(
          `\n**Step ${step.step}** — shell command **(requires your approval; not run automatically)**\n\n\`\`\`bash\n${step.command}\n\`\`\`\n`,
        );
        planState.completed.push({
          step:        step.step,
          action:      'run_command',
          command:     step.command,
          fingerprint: fp,
          status:      'pending_user_run',
        });
        planState.current_step_index++;
        continue;
      }

      planState.current_step_index++;
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('stream:end', { messageId, success: true });
    }
    return { success: true, content: transcript };
  }

  // ── Single-step fallback (existing behaviour) ──────────────────────────────
  const full = await streamChat({
    ollamaUrl,
    model,
    messages: context,
    system:   systemPrompt,
    onToken: (token) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('stream:token', { token, messageId });
      }
    },
  });
  transcript = full;
  const finalContent = await appendUsePluginFromFullReply({ win, messageId, full });
  if (win && !win.isDestroyed()) {
    win.webContents.send('stream:end', { messageId, success: true });
  }
  return { success: true, content: finalContent };
  } catch (err) {
    const errorMsg = err.message || 'LLM request failed';
    logError('agent.run_error', { error: errorMsg, messageId });
    if (win && !win.isDestroyed()) {
      win.webContents.send('stream:end', { messageId, success: false, error: errorMsg });
    }
    return { success: false, error: errorMsg };
  } finally {
    agentPlanState.clear(messageId);
  }
}

module.exports = { runAgentMessage };
