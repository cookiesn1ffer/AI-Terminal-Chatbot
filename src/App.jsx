import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import SettingsModal from './components/SettingsModal';
import TerminalOutput from './components/TerminalOutput';
import HistoryPanel from './components/HistoryPanel';

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const MAX_LINES_PER_COMMAND = 1000;

function newSession() {
  return {
    id:        uid(),
    title:     'New conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages:  [],
  };
}

function createTerminalTab(index) {
  return {
    id: `tab-${Date.now()}-${index}`,
    name: `Session ${index}`,
    commands: {},
    history: [],
    input: '',
    showHistory: false,
    cwd: null, // null = main process will use os.homedir(); updated after cd commands
  };
}

function trimLines(lines) {
  if (lines.length <= MAX_LINES_PER_COMMAND) return lines;
  return lines.slice(lines.length - MAX_LINES_PER_COMMAND);
}

const DEFAULT_SETTINGS = {
  ollamaUrl:     'http://localhost:11434',
  model:         'mistral',
  showRunButton: true,
  timeout:       30000,
  maxOutput:     65536,
};

const ChatIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
  </svg>
);

const TerminalIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round"
      d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const PlusIcon = () => (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const CloseIcon = () => (
  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState(null);
  const [activeTab, setActiveTab] = useState('chat');
  const _initialTab = useRef(null);
  if (!_initialTab.current) _initialTab.current = createTerminalTab(1);

  const [terminalTabs, setTerminalTabs] = useState([_initialTab.current]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState(_initialTab.current.id);

  const streamingContentRef = useRef('');
  const terminalTabCounterRef = useRef(1);
  const activeTerminalTabIdRef = useRef(activeTerminalTabId);
  const terminalTabsRef = useRef(terminalTabs);         // always reflects latest tabs
  const commandToTabRef = useRef(new Map());
  const commandBuffersRef = useRef({});
  const flushTimerRef = useRef(null);

  // Keep terminalTabsRef in sync so callbacks closed over it always read fresh state.
  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  useEffect(() => {
    const initialTab = createTerminalTab(1);
    terminalTabCounterRef.current = 1;
    setTerminalTabs([initialTab]);
    setActiveTerminalTabId(initialTab.id);
  }, []);

  useEffect(() => {
    activeTerminalTabIdRef.current = activeTerminalTabId;
  }, [activeTerminalTabId]);

  useEffect(() => {
    async function boot() {
      try {
        const [savedSessions, savedSettings] = await Promise.all([
          window.electronAPI.loadSessions(),
          window.electronAPI.loadSettings(),
        ]);
        const all = savedSessions.length > 0 ? savedSessions : [newSession()];
        setSessions(all);
        setActiveId(all[0].id);
        setSettings(s => ({ ...s, ...savedSettings }));
      } catch {
        const s = newSession();
        setSessions([s]);
        setActiveId(s.id);
      }
    }
    boot();
  }, []);

  useEffect(() => {
    const removeToken = window.electronAPI.onStreamToken(({ token, messageId }) => {
      streamingContentRef.current += token;
      setSessions(prev => prev.map(sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.id === messageId ? { ...m, content: streamingContentRef.current } : m
        ),
      })));
    });

    const removeEnd = window.electronAPI.onStreamEnd(({ messageId, success, error }) => {
      setIsStreaming(false);
      setStreamingMsgId(null);
      if (!success && error) {
        setSessions(prev => prev.map(sess => ({
          ...sess,
          messages: sess.messages.map(m =>
            m.id === messageId ? { ...m, content: `_Error: ${error}_`, isError: true } : m
          ),
        })));
      }
      setSessions(prev => {
        const sess = prev.find(s => s.messages.some(m => m.id === messageId));
        if (sess) window.electronAPI.saveSession({ ...sess, updatedAt: new Date().toISOString() });
        return prev;
      });
    });

    return () => {
      removeToken?.();
      removeEnd?.();
    };
  }, []);

  useEffect(() => {
    const flushCommandBuffers = () => {
      const pending = Object.entries(commandBuffersRef.current);
      if (pending.length === 0) return;

      commandBuffersRef.current = {};
      setTerminalTabs(prevTabs => prevTabs.map((tab) => {
        let nextTab = tab;

        for (const [commandId, lines] of pending) {
          const mappedTabId = commandToTabRef.current.get(commandId);
          if (mappedTabId !== tab.id || !tab.commands[commandId]) continue;

          nextTab = {
            ...nextTab,
            commands: {
              ...nextTab.commands,
              [commandId]: {
                ...nextTab.commands[commandId],
                lines: trimLines(nextTab.commands[commandId].lines.concat(lines)),
              },
            },
          };
        }

        return nextTab;
      }));
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushCommandBuffers();
      }, 50);
    };

    const ensureCommandInTab = (tabId, payload) => {
      setTerminalTabs(prevTabs => prevTabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const existing = tab.commands[payload.id];
        return {
          ...tab,
          commands: {
            ...tab.commands,
            [payload.id]: {
              id: payload.id,
              commandText: payload.command || existing?.commandText || '',
              lines: existing?.lines || [],
              exitCode: null,
              isRunning: true,
              startedAt: existing?.startedAt || Date.now(),
            },
          },
        };
      }));
    };

    const removeStart = window.electronAPI.onCommandStart((payload) => {
      if (!payload?.id) return;
      const tabId = commandToTabRef.current.get(payload.id) || activeTerminalTabIdRef.current;
      commandToTabRef.current.set(payload.id, tabId);
      ensureCommandInTab(tabId, payload);
    });

    const removeStream = window.electronAPI.onCommandStream((payload) => {
      if (!payload?.id || typeof payload.data !== 'string') return;
      const tabId = commandToTabRef.current.get(payload.id) || activeTerminalTabIdRef.current;
      commandToTabRef.current.set(payload.id, tabId);

      if (!commandBuffersRef.current[payload.id]) {
        commandBuffersRef.current[payload.id] = [];
      }

      commandBuffersRef.current[payload.id].push({
        id: `${payload.id}-${Date.now()}-${commandBuffersRef.current[payload.id].length}`,
        type: payload.type === 'stderr' ? 'stderr' : 'stdout',
        data: payload.data,
      });

      scheduleFlush();
    });

    const removeComplete = window.electronAPI.onCommandComplete((payload) => {
      if (!payload?.id) return;

      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      flushCommandBuffers();

      const tabId = commandToTabRef.current.get(payload.id);
      if (!tabId) return;

      setTerminalTabs(prevTabs => prevTabs.map((tab) => {
        if (tab.id !== tabId) return tab;

        // cwd update (from cd commands) must happen even if the command entry
        // isn't in the tab yet — command-start and command-complete arrive nearly
        // simultaneously for cd, so the state update from command-start may not
        // have committed before command-complete fires.
        const cwdPatch = payload.newCwd ? { cwd: payload.newCwd } : {};

        // Only update the command entry if it already exists in this tab.
        const commandPatch = tab.commands[payload.id]
          ? {
              commands: {
                ...tab.commands,
                [payload.id]: {
                  ...tab.commands[payload.id],
                  exitCode: payload.exitCode ?? null,
                  isRunning: false,
                },
              },
            }
          : {};

        return { ...tab, ...cwdPatch, ...commandPatch };
      }));

      // Delay cleanup so any in-flight command-stream events that arrive
      // a tick after command-complete can still find the tab mapping.
      setTimeout(() => commandToTabRef.current.delete(payload.id), 500);
    });

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      removeStart?.();
      removeStream?.();
      removeComplete?.();
    };
  }, []);

  const activeSession = sessions.find(s => s.id === activeId) ?? null;
  const activeTerminalTab = terminalTabs.find(tab => tab.id === activeTerminalTabId) ?? terminalTabs[0];

  const updateTerminalTab = useCallback((tabId, updater) => {
    setTerminalTabs(prevTabs => prevTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      return updater(tab);
    }));
  }, []);

  const handleNewSession = useCallback(() => {
    const sess = newSession();
    setSessions(prev => [sess, ...prev]);
    setActiveId(sess.id);
  }, []);

  const handleSelectSession = useCallback((id) => {
    if (!isStreaming) setActiveId(id);
  }, [isStreaming]);

  const handleDeleteSession = useCallback(async (id) => {
    await window.electronAPI.deleteSession(id);
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id);
      if (remaining.length === 0) {
        const fresh = newSession();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
  }, [activeId]);

  const executeCommandInTab = useCallback(async (tabId, commandText) => {
    const trimmedCommand = commandText.trim();
    if (!trimmedCommand) return;

    setActiveTab('terminal');
    setActiveTerminalTabId(tabId);

    updateTerminalTab(tabId, (tab) => ({
      ...tab,
      input: '',
      history: tab.history[tab.history.length - 1] === trimmedCommand
        ? tab.history
        : [...tab.history, trimmedCommand],
    }));

    // Read from ref so we always get the latest cwd even inside a stale closure.
    const currentTab = terminalTabsRef.current.find(t => t.id === tabId);
    const result = await window.electronAPI.runCommand(trimmedCommand, currentTab?.cwd || null);
    if (!result?.success || !result.id) {
      const fallbackId = `failed-${Date.now()}`;
      updateTerminalTab(tabId, (tab) => ({
        ...tab,
        commands: {
          ...tab.commands,
          [fallbackId]: {
            id: fallbackId,
            commandText: trimmedCommand,
            lines: [{
              id: `${fallbackId}-error`,
              type: 'stderr',
              data: result?.error || 'Failed to start command',
            }],
            exitCode: -1,
            isRunning: false,
            startedAt: Date.now(),
          },
        },
      }));
      return;
    }

    commandToTabRef.current.set(result.id, tabId);
    updateTerminalTab(tabId, (tab) => ({
      ...tab,
      commands: {
        ...tab.commands,
        [result.id]: {
          id: result.id,
          commandText: trimmedCommand,
          lines: tab.commands[result.id]?.lines || [],
          exitCode: null,
          isRunning: true,
          startedAt: tab.commands[result.id]?.startedAt || Date.now(),
        },
      },
    }));
  }, [updateTerminalTab]);

  const handleSend = useCallback(async (text) => {
    if (!text.trim() || isStreaming || !activeSession) return;

    const userMsg = {
      id:        uid(),
      role:      'user',
      content:   text.trim(),
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = uid();
    const assistantMsg = {
      id:        assistantMsgId,
      role:      'assistant',
      content:   '',
      timestamp: new Date().toISOString(),
    };

    const isFirstMsg = activeSession.messages.length === 0;
    const title = isFirstMsg
      ? text.slice(0, 50) + (text.length > 50 ? '…' : '')
      : activeSession.title;

    const updatedMessages = [...activeSession.messages, userMsg, assistantMsg];

    setSessions(prev => prev.map(s =>
      s.id === activeId
        ? { ...s, title, messages: updatedMessages, updatedAt: new Date().toISOString() }
        : s
    ));

    streamingContentRef.current = '';
    setIsStreaming(true);
    setStreamingMsgId(assistantMsgId);

    try {
      const result = await window.electronAPI.sendMessage({
        messages: updatedMessages
          .filter(m => !(m.role === 'assistant' && m.id === assistantMsgId))
          .map(m => ({ role: m.role, content: m.content })),
        settings,
        messageId: assistantMsgId,
      });

      if (result && result.success === false && result.error) {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setSessions(prev => prev.map(sess => ({
          ...sess,
          messages: sess.messages.map(m =>
            m.id === assistantMsgId ? { ...m, content: `Error: ${result.error}`, isError: true } : m
          ),
        })));
      }
    } catch (err) {
      setIsStreaming(false);
      setStreamingMsgId(null);
      setSessions(prev => prev.map(sess => ({
        ...sess,
        messages: sess.messages.map(m =>
          m.id === assistantMsgId ? { ...m, content: `Error: ${err.message}`, isError: true } : m
        ),
      })));
    }
  }, [activeSession, activeId, isStreaming, settings]);

  const handleRunCommand = useCallback((command) => {
    setActiveTab('terminal');
    executeCommandInTab(activeTerminalTabIdRef.current, command);
  }, [executeCommandInTab]);

  const handleSettingsSave = useCallback(async (newSettings) => {
    setSettings(newSettings);
    try {
      const result = await window.electronAPI.saveSettings(newSettings);
      if (result && result.success === false) {
        throw new Error(result.error || 'Could not save settings');
      }
      setShowSettings(false);
    } catch (err) {
      window.alert(`Could not save settings: ${err.message}`);
    }
  }, []);

  const handleNewTerminalTab = useCallback(() => {
    terminalTabCounterRef.current += 1;
    const newTab = createTerminalTab(terminalTabCounterRef.current);
    setTerminalTabs((prev) => [...prev, newTab]);
    setActiveTerminalTabId(newTab.id);
  }, []);

  const handleCloseTerminalTab = useCallback(async (tabId) => {
    const tab = terminalTabs.find((item) => item.id === tabId);
    if (!tab) return;

    const runningCommandIds = Object.values(tab.commands)
      .filter((command) => command.isRunning)
      .map((command) => command.id);

    await Promise.all(runningCommandIds.map((id) => window.electronAPI.cancelCommand(id)));
    runningCommandIds.forEach((id) => commandToTabRef.current.delete(id));

    setTerminalTabs((prev) => {
      const remaining = prev.filter((item) => item.id !== tabId);
      if (remaining.length === 0) {
        terminalTabCounterRef.current += 1;
        const replacement = createTerminalTab(terminalTabCounterRef.current);
        setActiveTerminalTabId(replacement.id);
        return [replacement];
      }
      if (activeTerminalTabIdRef.current === tabId) {
        setActiveTerminalTabId(remaining[0].id);
      }
      return remaining;
    });
  }, [terminalTabs]);

  const handleTerminalInputChange = useCallback((value) => {
    const tabId = activeTerminalTabIdRef.current;
    updateTerminalTab(tabId, (tab) => ({
      ...tab,
      input: value,
    }));
  }, [updateTerminalTab]);

  const handleTerminalSubmit = useCallback(() => {
    if (!activeTerminalTab) return;
    executeCommandInTab(activeTerminalTab.id, activeTerminalTab.input);
  }, [activeTerminalTab, executeCommandInTab]);

  // Tab-completion state: tracks the current completion cycle so pressing Tab
  // repeatedly cycles through all matches without re-querying the main process.
  const tabStateRef = useRef({ completions: [], index: -1, base: '' });

  const handleTabComplete = useCallback(async () => {
    const tabId      = activeTerminalTabIdRef.current;
    const currentTab = terminalTabsRef.current.find(t => t.id === tabId);
    const input      = currentTab?.input ?? '';
    const cwd        = currentTab?.cwd   ?? null;
    const state      = tabStateRef.current;

    // If we're already cycling through a completion set for the same base input,
    // just advance the index.
    if (state.completions.length > 0 && state.base === input) {
      const next = (state.index + 1) % state.completions.length;
      tabStateRef.current = { ...state, index: next };
      updateTerminalTab(tabId, tab => ({ ...tab, input: state.completions[next] }));
      return;
    }

    // First Tab press (or input changed) — fetch fresh completions.
    try {
      const result = await window.electronAPI.tabComplete(input, cwd);
      const completions = result?.completions ?? [];
      if (completions.length === 0) return;

      tabStateRef.current = { completions, index: 0, base: completions[0] };
      updateTerminalTab(tabId, tab => ({ ...tab, input: completions[0] }));
    } catch { /* silently ignore */ }
  }, [updateTerminalTab]);

  const handleTerminalKeyDown = useCallback((event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      handleTabComplete();
      return;
    }
    // Any key other than Tab resets the completion cycle.
    if (event.key !== 'Tab') {
      tabStateRef.current = { completions: [], index: -1, base: '' };
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleTerminalSubmit();
    }
  }, [handleTabComplete, handleTerminalSubmit]);

  const handleToggleHistory = useCallback(() => {
    if (!activeTerminalTab) return;
    updateTerminalTab(activeTerminalTab.id, (tab) => ({
      ...tab,
      showHistory: !tab.showHistory,
    }));
  }, [activeTerminalTab, updateTerminalTab]);

  const handleReplayHistory = useCallback((command) => {
    if (!activeTerminalTab) return;
    executeCommandInTab(activeTerminalTab.id, command);
  }, [activeTerminalTab, executeCommandInTab]);

  const handleCancelCommand = useCallback(async (commandId) => {
    await window.electronAPI.cancelCommand(commandId);
  }, []);

  const handleClearTerminal = useCallback(() => {
    const tabId = activeTerminalTabIdRef.current;
    updateTerminalTab(tabId, (tab) => ({ ...tab, commands: {} }));
  }, [updateTerminalTab]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d0d0d] text-[#e2e8f0]">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onNew={handleNewSession}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onSettings={() => setShowSettings(true)}
        isStreaming={isStreaming}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag-region flex items-center justify-between border-b border-[#2a2a2a] px-4" style={{ minHeight: '45px' }}>
          <div className="no-drag flex items-center gap-2">
            <span className="max-w-xs truncate text-xs font-medium text-[#e2e8f0]">
              {activeTab === 'chat'
                ? (activeSession?.title || 'New conversation')
                : (activeTerminalTab?.name || 'Terminal')}
            </span>
          </div>

          <div className="no-drag flex items-center">
            <div className="flex rounded-lg border border-[#2a2a2a] bg-[#1c1c1c] p-0.5">
              {[
                { id: 'chat', label: 'Chat', Icon: ChatIcon },
                { id: 'terminal', label: 'Terminal', Icon: TerminalIcon },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    activeTab === id
                      ? 'bg-[#2a2a2a] text-[#e2e8f0] shadow-sm'
                      : 'text-[#64748b] hover:text-[#94a3b8]'
                  }`}
                >
                  <Icon />
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'chat' && (
              <span className="ml-3 rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1 text-xs text-[#64748b]">
                {settings.model}
              </span>
            )}
          </div>
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ display: activeTab === 'chat' ? 'flex' : 'none' }}
        >
          <ChatWindow
            messages={activeSession?.messages ?? []}
            isStreaming={isStreaming}
            streamingMsgId={streamingMsgId}
            showRunButton={settings.showRunButton}
            onRunCommand={handleRunCommand}
          />
          <InputBar
            onSend={handleSend}
            isDisabled={isStreaming}
          />
        </div>

        <div
          className="flex min-h-0 flex-1 flex-col bg-[#0a0a0a]"
          style={{ display: activeTab === 'terminal' ? 'flex' : 'none' }}
        >
          <div className="flex items-center gap-2 border-b border-[#21262d] bg-[#0d1117] px-3 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {terminalTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                    activeTerminalTabId === tab.id
                      ? 'border-[#3b82f6] bg-[#161b22] text-[#f0f6fc]'
                      : 'border-[#30363d] bg-[#0d1117] text-[#8b949e]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTerminalTabId(tab.id)}
                    className="truncate"
                  >
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCloseTerminalTab(tab.id)}
                    className="text-[#8b949e] transition-colors hover:text-[#f0f6fc]"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleNewTerminalTab}
              className="rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-[#c9d1d9] transition-colors hover:bg-[#21262d]"
            >
              <PlusIcon />
            </button>
          </div>

          <div className="flex flex-col border-b border-[#21262d] bg-[#0d1117] px-3 py-2 gap-1.5">
            {activeTerminalTab?.cwd && (
              <span className="text-xs text-[#6e7681] font-mono select-all">
                {activeTerminalTab.cwd}
              </span>
            )}
            <div className="flex items-center gap-2">
            <input
              type="text"
              value={activeTerminalTab?.input || ''}
              onChange={(event) => handleTerminalInputChange(event.target.value)}
              onKeyDown={handleTerminalKeyDown}
              placeholder="Enter command for this tab..."
              className="flex-1 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#f0f6fc] outline-none placeholder:text-[#6e7681]"
            />
            <button
              type="button"
              onClick={handleTerminalSubmit}
              className="rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#f0f6fc] transition-colors hover:bg-[#21262d]"
            >
              Run
            </button>
            <button
              type="button"
              onClick={handleToggleHistory}
              className="rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#f0f6fc] transition-colors hover:bg-[#21262d]"
            >
              History
            </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <TerminalOutput
                tab={activeTerminalTab}
                onCancel={handleCancelCommand}
                onClear={handleClearTerminal}
              />
            </div>

            {activeTerminalTab?.showHistory && (
              <HistoryPanel
                history={activeTerminalTab.history}
                onReplay={handleReplayHistory}
                onClose={handleToggleHistory}
              />
            )}
          </div>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
