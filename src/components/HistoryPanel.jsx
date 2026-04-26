export default function HistoryPanel({ history, onReplay, onClose }) {
  return (
    <div className="flex h-full w-72 flex-col border-l border-[#21262d] bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-[#21262d] px-3 py-2">
        <span className="text-sm font-medium text-[#f0f6fc]">History</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[#30363d] px-2 py-1 text-xs text-[#c9d1d9] transition-colors hover:bg-[#161b22]"
        >
          Hide
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {history.length === 0 ? (
          <div className="p-2 text-sm text-[#8b949e]">No commands yet.</div>
        ) : (
          history.map((item, index) => (
            <button
              key={`${item}-${index}`}
              type="button"
              onClick={() => onReplay(item)}
              className="mb-2 w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-2 text-left text-sm text-[#c9d1d9] transition-colors hover:bg-[#161b22]"
            >
              <span className="block truncate">{item}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
