'use strict';

/**
 * decision-layer.js -- Context-aware system prompt builder.
 *
 * Reads the conversation history, detects relevant services/tools,
 * and builds an enriched system prompt for the LLM.
 *
 * Also injects the list of available structured plugins so the LLM
 * knows when to emit a plugin_call block instead of a raw bash command.
 */

const { detectServices, buildServiceContext } = require('./service-profiles');

let _pluginManager = null;
function getPluginManager() {
  if (!_pluginManager) {
    try {
      const { pluginManager } = require('../pluginManager');
      _pluginManager = pluginManager;
    } catch (_err) {
      _pluginManager = { listPlugins: () => [] };
    }
  }
  return _pluginManager;
}

const BASE_SYSTEM_PROMPT = `You are an AI-powered terminal assistant running inside a native desktop application.
Your role is to help users understand their system, analyze command output, and accomplish system management tasks.

CORE BEHAVIOUR:
- Be concise and technically precise.
- When suggesting commands, always wrap them in a code block with the "bash" language tag.
- Briefly explain what each command does so the user understands before running it.
- When you see command output pasted by the user, interpret it clearly and suggest relevant next steps.
- If an error appears in output, diagnose the likely cause and suggest a fix.
- Prefer composable, readable commands over one-liners that are hard to understand.
- Never execute anything yourself -- only suggest. The user controls execution.

FORMATTING RULES:
- Use markdown. Headings, bullet points, and code blocks render correctly.
- Commands must be in a \`\`\`bash ... \`\`\` block -- the UI renders these with copy and run buttons.
- For multi-step workflows, number the steps clearly.
- Keep explanations short. The user is technical.

SCOPE:
- You assist with: system monitoring, log analysis, process management, network diagnostics,
  configuration review, file system operations, debugging, and DevOps workflows.
- You do not assist with attacking or exploiting systems you don't own.`;

const PLUGIN_INSTRUCTIONS = `
STRUCTURED PLUGINS:
You have access to structured plugins that return rich, parsed data directly -- no shell parsing needed.
Use a plugin when it fits the task better than a raw bash command.

To invoke a plugin, emit a JSON code block (language tag: "json") containing:
{
  "type": "plugin_call",
  "plugin": "<plugin-name>",
  "input": { ... },
  "reason": "one sentence explaining why this plugin is the right tool"
}

The UI will render this as an interactive block with an Execute button.
The user clicks Execute to run it and sees the structured result inline.

WHEN TO USE PLUGINS vs BASH:
- Use a plugin when you need structured, parsed output (e.g. process list as JSON, file tree with sizes).
- Use bash when you need a one-off command the user can run themselves in their terminal.
- Prefer plugins for read-only information gathering; bash for actions the user needs to own.

AVAILABLE PLUGINS:`;

function formatPluginList(plugins) {
  if (!plugins || plugins.length === 0) {
    return '\n(No plugins currently loaded.)';
  }

  return plugins.map(p => {
    const params = p.parameters && Object.keys(p.parameters).length > 0
      ? JSON.stringify(p.parameters, null, 2)
          .split('\n')
          .map(l => '    ' + l)
          .join('\n')
      : '    (no parameters schema)';

    return `\n  Plugin: ${p.name}\n  Description: ${p.description}\n  Parameters:\n${params}`;
  }).join('\n');
}

function buildSystemPrompt(messages, settings = {}) {
  const recentText = messages
    .slice(-6)
    .map(m => m.content)
    .join('\n');

  const detectedServices = detectServices(recentText);
  const serviceContext   = buildServiceContext(detectedServices);

  const plugins    = getPluginManager().listPlugins();
  const pluginText = PLUGIN_INSTRUCTIONS + formatPluginList(plugins);

  const parts = [BASE_SYSTEM_PROMPT, pluginText];

  if (serviceContext) {
    parts.push(`---\nCONTEXT FROM CURRENT SESSION:\n${serviceContext}\n---\nUse the above context to make your suggestions more targeted and relevant.`);
  }

  return parts.join('\n\n');
}

module.exports = { buildSystemPrompt };
