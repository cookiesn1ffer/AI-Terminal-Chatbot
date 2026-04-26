import { useEffect, useRef } from 'react';
import ChatBubble from './ChatBubble';

export default function ChatWindow({ messages, isStreaming, streamingMsgId, showRunButton, onRunCommand }) {
  const bottomRef    = useRef(null);
  const containerRef = useRef(null);

  // Track whether the user has scrolled up so we don't hijack their position.
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
      userScrolledUp.current = !atBottom;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll on new messages (always) and on every streaming token (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Track the content of the last message to detect new streaming tokens
  const lastMsgContent = messages.length > 0 ? messages[messages.length - 1].content : '';
  useEffect(() => {
    if (isStreaming && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgContent, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-app-surface border border-app-border
                        flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-app-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-app-text mb-2">AI &amp; Terminal Chatbot</h2>
        <p className="text-sm text-app-muted max-w-sm leading-relaxed">
          Ask me anything about your system. Paste command output for analysis,
          or describe what you're trying to accomplish.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-sm">
          {[
            'What processes are using the most memory?',
            'Analyze this: paste your ps aux output here',
            'How do I check which ports are open?',
            'My nginx service won\'t start — how do I debug it?',
          ].map(hint => (
            <button
              key={hint}
              className="text-left px-3 py-2 rounded-lg bg-app-surface border border-app-border
                         text-xs text-app-muted hover:text-app-text hover:border-app-accent/30
                         transition-colors"
              onClick={() => {
                const input = document.querySelector('textarea');
                if (input) {
                  input.value = hint;
                  input.focus();
                  // Trigger React onChange
                  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                  nativeInputValueSetter.call(input, hint);
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }}
            >
              {hint}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-4">
      {messages.map(msg => (
        <ChatBubble
          key={msg.id}
          message={msg}
          isStreaming={isStreaming && msg.id === streamingMsgId}
          showRunButton={showRunButton}
          onRun={onRunCommand}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
