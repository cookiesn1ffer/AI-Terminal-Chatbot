import CommandBlock from './CommandBlock';
import PluginBlock  from './PluginBlock';
import TypingIndicator from './TypingIndicator';

/**
 * parseContent -- splits markdown into segments.
 *
 * Segment types:
 *   { type: 'text',   content }
 *   { type: 'code',   content, language }
 *   { type: 'plugin', call }   <-- json block with "type": "plugin_call"
 */
function parseContent(raw) {
  if (!raw) return [];

  const segments = [];
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRe.exec(raw)) !== null) {
    // Text before this block
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: raw.slice(lastIndex, match.index) });
    }

    const lang    = (match[1] || '').toLowerCase();
    const content = match[2].trim();

    // Check whether this is a plugin_call block
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(content);
        if (parsed && parsed.type === 'plugin_call' && typeof parsed.plugin === 'string') {
          segments.push({ type: 'plugin', call: parsed });
          lastIndex = match.index + match[0].length;
          continue;
        }
      } catch (_) {
        // Not valid JSON or not a plugin_call -- fall through to normal code block
      }
    }

    segments.push({ type: 'code', language: lang || 'bash', content });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last block
  if (lastIndex < raw.length) {
    segments.push({ type: 'text', content: raw.slice(lastIndex) });
  }

  return segments;
}

/**
 * renderInline -- converts minimal markdown syntax in a text segment.
 * Handles **bold**, *italic*, `inline code`, headings, lists, and line breaks.
 */
function renderInline(text) {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    if (/^### /.test(line)) return <h3 key={lineIdx} className="text-sm font-semibold mt-3 mb-1 text-app-text">{line.slice(4)}</h3>;
    if (/^## /.test(line))  return <h2 key={lineIdx} className="text-sm font-semibold mt-3 mb-1 text-app-text">{line.slice(3)}</h2>;
    if (/^# /.test(line))   return <h1 key={lineIdx} className="text-sm font-semibold mt-3 mb-1 text-app-text">{line.slice(2)}</h1>;

    if (/^[-*] /.test(line)) {
      return (
        <li key={lineIdx} className="ml-4 list-disc text-sm leading-relaxed">
          {inlineSpans(line.slice(2))}
        </li>
      );
    }

    if (/^\d+\. /.test(line)) {
      const dotIdx = line.indexOf('. ');
      return (
        <li key={lineIdx} className="ml-4 list-decimal text-sm leading-relaxed">
          {inlineSpans(line.slice(dotIdx + 2))}
        </li>
      );
    }

    if (/^---+$/.test(line.trim())) return <hr key={lineIdx} className="border-app-border my-2" />;
    if (!line.trim()) return <br key={lineIdx} />;

    return <p key={lineIdx} className="text-sm leading-relaxed">{inlineSpans(line)}</p>;
  });
}

function inlineSpans(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part))     return <em key={i}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part))       return <code key={i} className="font-mono text-xs bg-app-surface px-1 py-0.5 rounded text-amber-300">{part.slice(1, -1)}</code>;
    return part;
  });
}

// ── Terminal output bubble ────────────────────────────────────────────────────

function TerminalBubble({ message }) {
  const success = message.exitCode === 0;
  const pending = message.exitCode === null;

  return (
    <div className="mb-4 mx-4">
      <div className="rounded-lg border border-app-border bg-app-code overflow-hidden max-w-3xl">
        <div className="flex items-center justify-between px-3 py-1.5 bg-app-surface border-b border-app-border">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              pending ? 'bg-amber-400 animate-pulse' :
              success ? 'bg-green-400' : 'bg-red-400'
            }`} />
            <span className="text-[11px] font-mono text-app-muted">{message.command}</span>
          </div>
          {!pending && (
            <span className={`text-[10px] font-mono ${success ? 'text-green-400' : 'text-red-400'}`}>
              exit {message.exitCode}
            </span>
          )}
        </div>
        <pre className="px-4 py-3 text-xs font-mono text-app-text whitespace-pre-wrap
                        break-all max-h-80 overflow-y-auto leading-relaxed">
          {message.output || (pending ? 'Running...' : '(no output)')}
        </pre>
      </div>
    </div>
  );
}

// ── Main ChatBubble ───────────────────────────────────────────────────────────

export default function ChatBubble({ message, isStreaming, showRunButton, onRun }) {
  if (message.role === 'terminal') {
    return <TerminalBubble message={message} />;
  }

  const isUser      = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const segments    = parseContent(message.content);

  return (
    <div className={`flex mb-4 px-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Avatar: assistant only */}
      {isAssistant && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-app-accent/20 border border-app-accent/30
                        flex items-center justify-center mr-3 mt-0.5">
          <span className="text-[10px] font-bold text-app-accent">AI</span>
        </div>
      )}

      <div className={`max-w-2xl w-full ${isUser ? 'flex justify-end' : ''}`}>
        <div className={`
          rounded-2xl px-4 py-3 text-sm
          ${isUser
            ? 'bg-app-user text-app-text rounded-br-sm max-w-md'
            : 'bg-app-assistant text-app-text rounded-bl-sm border border-app-border w-full'
          }
        `}>
          {/* Error state */}
          {message.isError && (
            <p className="text-red-400 text-xs italic">{message.content}</p>
          )}

          {/* Normal content */}
          {!message.isError && segments.map((seg, i) => {
            // Plugin call block -- renders as interactive PluginBlock
            if (seg.type === 'plugin') {
              return <PluginBlock key={i} call={seg.call} />;
            }

            // Regular code block (bash, python, etc.) -- renders as CommandBlock
            if (seg.type === 'code') {
              return (
                <CommandBlock
                  key={i}
                  command={seg.content}
                  language={seg.language}
                  showRunButton={showRunButton && isAssistant}
                  onRun={onRun}
                />
              );
            }

            // Plain text with inline markdown rendering
            return (
              <div key={i} className="prose-custom">
                {renderInline(seg.content)}
              </div>
            );
          })}

          {/* Typing indicator while streaming and content is empty */}
          {isStreaming && isAssistant && !message.content && (
            <TypingIndicator />
          )}
        </div>

        {/* Timestamp */}
        <div className={`text-[10px] text-app-muted mt-1 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Avatar: user */}
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-app-user/50 border border-app-user
                        flex items-center justify-center ml-3 mt-0.5">
          <span className="text-[10px] font-bold text-blue-300">U</span>
        </div>
      )}
    </div>
  );
}
