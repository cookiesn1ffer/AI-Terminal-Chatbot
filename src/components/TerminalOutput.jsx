import { useEffect, useRef } from 'react';

export default function TerminalOutput({ tab, onCancel, onClear }) {
  const scrollContainerRef = useRef(null);
  const isUserScrolledRef  = useRef(false);

  // Track whether the user has scrolled up so we don't hijack their position.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      isUserScrolledRef.current = !atBottom;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll to bottom when commands or their lines change, unless user scrolled up.
  const commands = tab?.commands;
  useEffect(() => {
    if (isUserScrolledRef.current) return;
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [commands]);

  const orderedCommands = Object.values(tab?.commands || {}).sort(
    (a, b) => (a.startedAt || 0) - (b.startedAt || 0)
  );

  return (
    <div className="flex h-full w-full flex-col bg-[#0d1117] font-mono text-sm">
      {/* Toolbar */}
      {orderedCommands.length > 0 && (
        <div className="flex items-center justify-end border-b border-[#21262d] px-3 py-1.5">
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-[#30363d] px-2 py-1 text-xs text-[#8b949e] transition-colors hover:bg-[#161b22] hover:text-[#c9d1d9]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Command cards — plain block so cards stack at natural height and the
          container scrolls, rather than flex children dividing available space */}
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3"
      >
        {orderedCommands.length === 0 ? (
          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-[#8b949e]">
            No commands in this tab yet.
          </div>
        ) : (
          orderedCommands.map((cmd) => (
            <CommandCard
              key={cmd.id}
              cmd={cmd}
              onCancel={onCancel}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CommandCard({ cmd, onCancel }) {
  const outputRef = useRef(null);

  // Auto-scroll inside the card output area as new lines arrive.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cmd.lines]);

  const hasOutput = cmd.lines.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-[#30363d] bg-[#0d1117]">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-[#21262d] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-[#8b949e]">
          <span
            className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
              cmd.isRunning ? 'bg-[#3fb950]' : 'bg-[#6e7681]'
            }`}
          />
          <span>{cmd.isRunning ? 'Running' : 'Completed'}</span>
          {cmd.exitCode !== null && (
            <span className={`text-xs ${cmd.exitCode === 0 ? 'text-[#3fb950]' : 'text-[#ff7b72]'}`}>
              Exit {cmd.exitCode}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onCancel(cmd.id)}
          disabled={!cmd.isRunning}
          className="rounded border border-[#30363d] px-2 py-1 text-xs text-[#c9d1d9] transition-colors hover:bg-[#161b22] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel
        </button>
      </div>

      {/* Command text */}
      {cmd.commandText && (
        <div className="border-b border-[#21262d] bg-[#0f172a] px-3 py-2 text-[#60a5fa]">
          $ {cmd.commandText}
        </div>
      )}

      {/* Output */}
      <div
        ref={outputRef}
        className="max-h-96 overflow-y-auto p-3"
      >
        {!hasOutput ? (
          cmd.isRunning ? (
            <span className="text-[#8b949e]">Running…</span>
          ) : (
            <span className="text-[#8b949e] italic">No output.</span>
          )
        ) : (
          // Render stdout and stderr as single contiguous blocks rather than
          // one <pre> per chunk — avoids visual gaps between data events.
          (() => {
            const blocks = [];
            let current = null;
            for (const line of cmd.lines) {
              if (!current || current.type !== line.type) {
                current = { type: line.type, text: line.data, key: line.id };
                blocks.push(current);
              } else {
                current.text += line.data;
              }
            }
            return blocks.map(b => (
              <pre
                key={b.key}
                className={`whitespace-pre-wrap break-words leading-snug ${
                  b.type === 'stderr' ? 'text-[#ff7b72]' : 'text-[#f0f6fc]'
                }`}
              >
                {b.text}
              </pre>
            ));
          })()
        )}
      </div>
    </div>
  );
}
