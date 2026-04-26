import { useState, useCallback } from 'react';

/**
 * PluginBlock.jsx -- Interactive plugin call renderer.
 *
 * Rendered by ChatBubble when it detects a json code block
 * containing { "type": "plugin_call", "plugin": "...", "input": {...} }.
 *
 * UX: two-click confirmation (like CommandBlock):
 *   1. First click -> "Confirm Execute" state
 *   2. Second click -> executes via window.pluginAPI.executePlugin()
 *   3. Shows spinner while running, then result or error inline.
 *
 * Self-contained: no props beyond the parsed call object.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Render a value as formatted JSON, collapsing primitives to a single line.
 */
function JsonView({ data, indent = 0 }) {
  const [collapsed, setCollapsed] = useState(indent > 1);

  if (data === null)      return <span className="plugin-json-null">null</span>;
  if (typeof data === 'boolean') return <span className="plugin-json-bool">{String(data)}</span>;
  if (typeof data === 'number')  return <span className="plugin-json-num">{data}</span>;
  if (typeof data === 'string')  return <span className="plugin-json-str">"{data}"</span>;

  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: '#888' }}>[]</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)} style={collapseBtn}>
          {collapsed ? `[+${data.length}]` : '[-]'}
        </button>
        {!collapsed && (
          <div style={{ marginLeft: 16 }}>
            {data.map((item, i) => (
              <div key={i}>
                <JsonView data={item} indent={indent + 1} />
                {i < data.length - 1 && <span style={{ color: '#888' }}>,</span>}
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return <span style={{ color: '#888' }}>{'{}'}</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)} style={collapseBtn}>
          {collapsed ? `{+${keys.length}}` : '{-}'}
        </button>
        {!collapsed && (
          <div style={{ marginLeft: 16 }}>
            {keys.map((k, i) => (
              <div key={k}>
                <span style={{ color: '#9ecbff' }}>"{k}"</span>
                <span style={{ color: '#ccc' }}>: </span>
                <JsonView data={data[k]} indent={indent + 1} />
                {i < keys.length - 1 && <span style={{ color: '#888' }}>,</span>}
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}

const collapseBtn = {
  background: 'none',
  border: 'none',
  color: '#58a6ff',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  padding: '0 2px',
};

// ── States ────────────────────────────────────────────────────────────────────

const STATE = {
  IDLE:     'idle',
  CONFIRM:  'confirm',
  RUNNING:  'running',
  DONE:     'done',
  ERROR:    'error',
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function PluginBlock({ call }) {
  const { plugin, input, reason } = call;

  const [state,    setState]    = useState(STATE.IDLE);
  const [result,   setResult]   = useState(null);
  const [duration, setDuration] = useState(null);
  const [errMsg,   setErrMsg]   = useState('');

  const handleClick = useCallback(async () => {
    if (state === STATE.IDLE) {
      setState(STATE.CONFIRM);
      return;
    }

    if (state === STATE.CONFIRM) {
      setState(STATE.RUNNING);
      try {
        const res = await window.pluginAPI.executePlugin(plugin, input || {});
        setDuration(res.duration);
        if (res.success) {
          setResult(res.data);
          setState(STATE.DONE);
        } else {
          setErrMsg(res.error || 'Plugin returned an error.');
          setState(STATE.ERROR);
        }
      } catch (err) {
        setErrMsg(err.message || 'Unexpected error executing plugin.');
        setState(STATE.ERROR);
      }
    }

    if (state === STATE.DONE || state === STATE.ERROR) {
      // Reset to allow re-run
      setState(STATE.IDLE);
      setResult(null);
      setErrMsg('');
      setDuration(null);
    }
  }, [state, plugin, input]);

  // ── Button label & colour ──────────────────────────────────────────────────
  let btnLabel  = 'Execute';
  let btnColor  = '#238636';
  let btnHover  = '#2ea043';

  if (state === STATE.CONFIRM) { btnLabel = 'Confirm Execute'; btnColor = '#9e6a03'; btnHover = '#b78105'; }
  if (state === STATE.RUNNING) { btnLabel = 'Running...';      btnColor = '#444';    btnHover = '#444'; }
  if (state === STATE.DONE)    { btnLabel = 'Re-run';          btnColor = '#1f6feb'; btnHover = '#388bfd'; }
  if (state === STATE.ERROR)   { btnLabel = 'Retry';           btnColor = '#b62324'; btnHover = '#da3633'; }

  const isDisabled = state === STATE.RUNNING;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.wrapper}>
      {/* Header row */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.icon}>&#9881;</span>
          <span style={styles.pluginName}>{plugin}</span>
          <span style={styles.badge}>plugin</span>
        </div>
        <button
          onClick={handleClick}
          disabled={isDisabled}
          style={{
            ...styles.btn,
            background: btnColor,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={e => { if (!isDisabled) e.target.style.background = btnHover; }}
          onMouseLeave={e => { if (!isDisabled) e.target.style.background = btnColor; }}
        >
          {state === STATE.RUNNING ? <span style={styles.spinner}>&#9696;</span> : null}
          {btnLabel}
        </button>
      </div>

      {/* Reason */}
      {reason && (
        <p style={styles.reason}>{reason}</p>
      )}

      {/* Input parameters */}
      {input && Object.keys(input).length > 0 && (
        <div style={styles.section}>
          <span style={styles.sectionLabel}>Input</span>
          <pre style={styles.pre}>
            <JsonView data={input} indent={0} />
          </pre>
        </div>
      )}

      {/* Confirm warning */}
      {state === STATE.CONFIRM && (
        <div style={styles.warning}>
          Click "Confirm Execute" again to run the <strong>{plugin}</strong> plugin.
        </div>
      )}

      {/* Result */}
      {state === STATE.DONE && result !== undefined && (
        <div style={styles.section}>
          <div style={styles.resultHeader}>
            <span style={{ ...styles.sectionLabel, color: '#3fb950' }}>Result</span>
            {duration !== null && (
              <span style={styles.duration}>{formatDuration(duration)}</span>
            )}
          </div>
          <pre style={styles.pre}>
            <JsonView data={result} indent={0} />
          </pre>
        </div>
      )}

      {/* Error */}
      {state === STATE.ERROR && (
        <div style={styles.errorBox}>
          <span style={{ color: '#f85149', fontWeight: 600 }}>Error: </span>
          {errMsg}
          {duration !== null && (
            <span style={styles.duration}> ({formatDuration(duration)})</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  wrapper: {
    background:   '#161b22',
    border:       '1px solid #30363d',
    borderRadius: 8,
    margin:       '8px 0',
    overflow:     'hidden',
    fontFamily:   'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize:     '0.82rem',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '8px 12px',
    background:     '#0d1117',
    borderBottom:   '1px solid #21262d',
  },
  headerLeft: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
  },
  icon: {
    fontSize: '1rem',
    color:    '#8b949e',
  },
  pluginName: {
    color:      '#e6edf3',
    fontWeight: 600,
    fontSize:   '0.88rem',
  },
  badge: {
    background:   '#21262d',
    border:       '1px solid #30363d',
    borderRadius: 4,
    color:        '#8b949e',
    fontSize:     '0.72rem',
    padding:      '1px 6px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  btn: {
    border:       'none',
    borderRadius: 6,
    color:        '#fff',
    fontSize:     '0.78rem',
    fontWeight:   600,
    padding:      '5px 12px',
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    transition:   'background 0.15s',
  },
  spinner: {
    display:   'inline-block',
    animation: 'spin 1s linear infinite',
  },
  reason: {
    color:     '#8b949e',
    margin:    '8px 12px 0',
    fontSize:  '0.8rem',
    fontStyle: 'italic',
  },
  section: {
    padding:    '8px 12px',
    borderTop:  '1px solid #21262d',
  },
  sectionLabel: {
    color:         '#8b949e',
    fontSize:      '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display:       'block',
    marginBottom:  4,
  },
  pre: {
    background:   '#0d1117',
    border:       '1px solid #21262d',
    borderRadius: 4,
    color:        '#e6edf3',
    margin:       0,
    maxHeight:    320,
    overflowY:    'auto',
    padding:      '8px 10px',
    fontSize:     '0.8rem',
    lineHeight:   1.5,
    whiteSpace:   'pre-wrap',
    wordBreak:    'break-all',
  },
  resultHeader: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   4,
  },
  duration: {
    color:    '#8b949e',
    fontSize: '0.75rem',
  },
  warning: {
    background: '#271a00',
    border:     '1px solid #9e6a03',
    borderRadius: 4,
    color:      '#e3b341',
    fontSize:   '0.8rem',
    margin:     '8px 12px',
    padding:    '6px 10px',
  },
  errorBox: {
    background:   '#1c0a0a',
    border:       '1px solid #b62324',
    borderRadius: 4,
    color:        '#e6edf3',
    fontSize:     '0.8rem',
    margin:       '8px 12px',
    padding:      '6px 10px',
  },
};
