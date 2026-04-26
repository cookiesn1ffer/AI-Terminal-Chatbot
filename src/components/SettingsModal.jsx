import { useState, useEffect } from 'react';

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

export default function SettingsModal({ settings, onSave, onClose }) {
  const [form,       setForm]       = useState({ ...settings });
  const [models,     setModels]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [urlStatus,  setUrlStatus]  = useState('idle'); // idle | ok | error

  // Load models when modal opens or URL changes
  useEffect(() => {
    fetchModels(form.ollamaUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchModels(url) {
    if (!url) return;
    setLoading(true);
    setUrlStatus('idle');
    try {
      const result = await window.electronAPI.getModels(url);
      if (result.success && result.models.length > 0) {
        setModels(result.models);
        setUrlStatus('ok');
        // Auto-select first model if current model not available
        if (!result.models.includes(form.model)) {
          setForm(f => ({ ...f, model: result.models[0] }));
        }
      } else {
        setModels([]);
        setUrlStatus('error');
      }
    } catch {
      setModels([]);
      setUrlStatus('error');
    } finally {
      setLoading(false);
    }
  }

  const handleSave = () => onSave(form);

  const toggle = (key) => setForm(f => ({ ...f, [key]: !f[key] }));

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-app-sidebar border border-app-border rounded-2xl shadow-2xl
                      flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-text">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-app-muted hover:text-app-text
                                               hover:bg-app-surface transition-colors">
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5 overflow-y-auto">

          {/* Ollama URL */}
          <div>
            <label className="block text-xs font-medium text-app-muted mb-1.5">
              Ollama URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.ollamaUrl}
                onChange={(e) => setForm(f => ({ ...f, ollamaUrl: e.target.value }))}
                placeholder="http://localhost:11434"
                className={`
                  flex-1 bg-app-surface border rounded-lg px-3 py-2 text-sm text-app-text
                  outline-none focus:border-app-accent/50 transition-colors placeholder-app-muted
                  ${urlStatus === 'ok'    ? 'border-green-500/50' :
                    urlStatus === 'error' ? 'border-red-500/50'   : 'border-app-border'}
                `}
              />
              <button
                onClick={() => fetchModels(form.ollamaUrl)}
                disabled={loading}
                title="Test connection"
                className="px-3 py-2 rounded-lg bg-app-surface border border-app-border
                           text-app-muted hover:text-app-text hover:border-app-muted
                           transition-colors disabled:opacity-50"
              >
                <RefreshIcon />
              </button>
            </div>

            {/* Status indicator */}
            <p className={`text-[11px] mt-1.5 ${
              urlStatus === 'ok'    ? 'text-green-400' :
              urlStatus === 'error' ? 'text-red-400'   : 'text-app-muted'
            }`}>
              {loading           ? 'Connecting…'                                      :
               urlStatus === 'ok'    ? `Connected — ${models.length} model(s) available` :
               urlStatus === 'error' ? 'Cannot reach Ollama. Is it running?'             :
               'Click refresh to test connection'}
            </p>
          </div>

          {/* Model selector */}
          <div>
            <label className="block text-xs font-medium text-app-muted mb-1.5">
              Model
            </label>
            {models.length > 0 ? (
              <select
                value={form.model}
                onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))}
                className="w-full bg-app-surface border border-app-border rounded-lg px-3 py-2
                           text-sm text-app-text outline-none focus:border-app-accent/50 transition-colors"
              >
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))}
                placeholder="e.g. mistral, llama3, gemma"
                className="w-full bg-app-surface border border-app-border rounded-lg px-3 py-2
                           text-sm text-app-text outline-none focus:border-app-accent/50 transition-colors
                           placeholder-app-muted"
              />
            )}
            <p className="text-[11px] text-app-muted mt-1">
              Recommended: mistral, llama3, qwen2.5-coder
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="block text-xs font-medium text-app-muted mb-1">Options</label>

            {[
              { key: 'showRunButton', label: 'Show "Run" button on commands',
                description: 'Let you execute suggested commands directly from the chat' },
            ].map(({ key, label, description }) => (
              <div key={key} className="flex items-start gap-3">
                <button
                  role="switch"
                  aria-checked={form[key]}
                  onClick={() => toggle(key)}
                  className={`
                    relative flex-shrink-0 w-9 h-5 rounded-full transition-colors mt-0.5
                    ${form[key] ? 'bg-app-accent' : 'bg-app-border'}
                  `}
                >
                  <span className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                    ${form[key] ? 'translate-x-[18px]' : 'translate-x-0.5'}
                  `} />
                </button>
                <div>
                  <p className="text-xs font-medium text-app-text">{label}</p>
                  <p className="text-[11px] text-app-muted">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-app-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-app-muted hover:text-app-text
                       hover:bg-app-surface transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-app-accent text-white
                       hover:bg-app-accent-hover transition-colors"
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
