import { useState } from 'react';

const CopyIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const PlayIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export default function CommandBlock({ command, language = 'bash', showRunButton = true, onRun }) {
  const [copied,   setCopied]   = useState(false);
  const [confirm,  setConfirm]  = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunClick = () => {
    if (!confirm) {
      // First click: show confirmation state
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3000);
    } else {
      // Second click: actually run
      setConfirm(false);
      onRun?.(command);
    }
  };

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-app-border bg-app-code">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-app-surface border-b border-app-border">
        <span className="text-[10px] font-mono text-app-muted uppercase tracking-widest">
          {language}
        </span>
        <div className="flex items-center gap-1">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            title="Copy to clipboard"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-app-muted
                       hover:text-app-text hover:bg-app-border transition-colors"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Run button (optional) */}
          {showRunButton && onRun && (
            <button
              onClick={handleRunClick}
              title={confirm ? 'Click again to confirm' : 'Run this command'}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors
                ${confirm
                  ? 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30'
                  : 'text-app-accent hover:bg-app-accent/10 hover:text-app-accent'
                }`}
            >
              <PlayIcon />
              <span>{confirm ? 'Confirm run?' : 'Run'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Code body */}
      <pre className="px-4 py-3 text-sm font-mono text-green-300 overflow-x-auto leading-relaxed
                      whitespace-pre-wrap break-all">
        <code>{command}</code>
      </pre>
    </div>
  );
}
