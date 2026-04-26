export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 h-5 px-1">
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-app-muted" />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-app-muted" />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-app-muted" />
    </div>
  );
}
