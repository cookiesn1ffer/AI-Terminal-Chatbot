import { useState, useRef, useCallback } from 'react';

const SendIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

export default function InputBar({ onSend, isDisabled }) {
  const [text,   setText]   = useState('');
  const textareaRef          = useRef(null);

  const submit = useCallback(() => {
    if (!text.trim() || isDisabled) return;
    onSend(text.trim());
    setText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isDisabled, onSend]);

  const handleKeyDown = (e) => {
    // Send on Enter, new line on Shift+Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
    // Auto-resize textarea
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  };

  return (
    <div className="border-t border-app-border px-4 py-3">
      <div className={`
        flex items-end gap-3 bg-app-surface border rounded-xl px-4 py-3 transition-colors
        ${isDisabled ? 'border-app-border opacity-60' : 'border-app-border hover:border-app-muted focus-within:border-app-accent/50'}
      `}>
        <textarea
          ref={textareaRef}
          value={text}
          onInput={handleInput}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isDisabled}
          placeholder={isDisabled ? 'Waiting for response…' : 'Ask anything, or paste command output to analyze…'}
          rows={1}
          className="flex-1 bg-transparent text-sm text-app-text placeholder-app-muted
                     resize-none outline-none leading-relaxed min-h-[24px] max-h-[180px]
                     disabled:cursor-not-allowed"
        />
        <button
          onClick={submit}
          disabled={isDisabled || !text.trim()}
          title="Send (Enter)"
          className={`
            flex-shrink-0 p-2 rounded-lg transition-colors
            ${isDisabled || !text.trim()
              ? 'text-app-muted cursor-not-allowed'
              : 'text-app-accent hover:bg-app-accent hover:text-white'}
          `}
        >
          <SendIcon />
        </button>
      </div>
      <p className="text-[10px] text-app-muted text-center mt-2">
        Enter to send &bull; Shift+Enter for new line
      </p>
    </div>
  );
}
