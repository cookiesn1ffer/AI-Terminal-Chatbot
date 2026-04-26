import { useState } from 'react';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const GearIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const TerminalIcon = () => (
  <svg className="w-5 h-5 text-app-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000)     return 'Just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Sidebar({ sessions, activeId, onNew, onSelect, onDelete, onSettings, isStreaming }) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <aside className="flex flex-col w-64 min-w-[200px] max-w-[280px] bg-app-sidebar border-r border-app-border h-full no-select">

      {/* Logo + new chat */}
      <div className="flex items-center justify-between px-4 py-4 drag-region">
        <div className="flex items-center gap-2 no-drag">
          <TerminalIcon />
          <span className="text-sm font-semibold tracking-tight text-app-text">AI &amp; Terminal Chatbot</span>
        </div>
        <button
          onClick={onNew}
          disabled={isStreaming}
          title="New conversation"
          className="no-drag p-1.5 rounded-md text-app-muted hover:text-app-text hover:bg-app-surface
                     transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sessions.map(sess => (
          <div
            key={sess.id}
            onClick={() => onSelect(sess.id)}
            onMouseEnter={() => setHoveredId(sess.id)}
            onMouseLeave={() => setHoveredId(null)}
            className={`
              group relative flex items-start gap-2 px-3 py-2.5 rounded-lg mb-0.5
              cursor-pointer transition-colors
              ${sess.id === activeId
                ? 'bg-app-surface text-app-text'
                : 'text-app-muted hover:bg-app-surface/60 hover:text-app-text'}
            `}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate leading-snug">
                {sess.title}
              </p>
              <p className="text-[10px] text-app-muted mt-0.5">
                {formatDate(sess.updatedAt)}
              </p>
            </div>

            {/* Delete button -- only visible on hover */}
            {hoveredId === sess.id && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(sess.id); }}
                className="flex-shrink-0 p-1 rounded text-app-muted hover:text-app-danger
                           hover:bg-app-danger/10 transition-colors"
                title="Delete conversation"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer: settings */}
      <div className="border-t border-app-border px-3 py-3">
        <button
          onClick={onSettings}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-app-muted
                     hover:text-app-text hover:bg-app-surface transition-colors text-xs"
        >
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
