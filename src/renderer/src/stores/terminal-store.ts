import { create } from 'zustand';
import type { PaneNode, SessionStatus, TerminalThemeName } from '@shared/types/terminal';
import { LIMITS } from '@shared/constants';

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return LIMITS.DEFAULT_FONT_SIZE;
  return Math.min(LIMITS.MAX_FONT_SIZE, Math.max(LIMITS.MIN_FONT_SIZE, Math.round(size)));
}

function getInitialFontSize(): number {
  try {
    const saved = localStorage.getItem('lunar-terminal-font-size');
    if (saved) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed)) return clampFontSize(parsed);
    }
  } catch {
    // localStorage may be unavailable
  }
  return LIMITS.DEFAULT_FONT_SIZE;
}

const VALID_THEMES: TerminalThemeName[] = [
  'dracula',
  'nord',
  'tokyo-night',
  'gruvbox',
  'one-dark',
  'monokai',
];

function getInitialTerminalTheme(): TerminalThemeName {
  try {
    const saved = localStorage.getItem('lunar-terminal-theme');
    if (saved && (VALID_THEMES as string[]).includes(saved)) return saved as TerminalThemeName;
  } catch {
    // localStorage may be unavailable
  }
  return 'dracula';
}

export interface TerminalSession {
  id: string;
  connectionId: string;
  connectionName: string;
  status: SessionStatus;
  title: string;
  type?: 'ssh' | 'local';
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  tabOrder: string[];
  activeTabId: string | null;
  splitTree: PaneNode | null;
  terminalTheme: TerminalThemeName;
  fontSize: number;
  scrollback: number;

  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveTab: (sessionId: string) => void;
  setTabOrder: (order: string[]) => void;
  setSplitTree: (tree: PaneNode | null) => void;
  setTerminalTheme: (theme: TerminalThemeName) => void;
  setFontSize: (size: number) => void;
  setScrollback: (lines: number) => void;
  renameTab: (sessionId: string, title: string) => void;
  closeTab: (sessionId: string) => void;
  closeOtherTabs: (sessionId: string) => void;
  closeTabsToRight: (sessionId: string) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  tabOrder: [],
  activeTabId: null,
  splitTree: null,
  terminalTheme: getInitialTerminalTheme(),
  fontSize: getInitialFontSize(),
  scrollback: 10000,

  addSession: (session) =>
    set((s) => {
      if (s.sessions.has(session.id)) {
        return { activeTabId: session.id };
      }
      const sessions = new Map(s.sessions);
      sessions.set(session.id, session);
      const tabOrder = [...s.tabOrder, session.id];
      return { sessions, tabOrder, activeTabId: session.id };
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.delete(sessionId);
      const tabOrder = s.tabOrder.filter((id) => id !== sessionId);
      const activeTabId =
        s.activeTabId === sessionId ? tabOrder[tabOrder.length - 1] || null : s.activeTabId;
      const splitTree =
        tabOrder.length === 0
          ? null
          : activeTabId
            ? { type: 'terminal' as const, sessionId: activeTabId }
            : null;
      return { sessions, tabOrder, activeTabId, splitTree };
    }),

  updateSessionStatus: (sessionId, status) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status });
      }
      return { sessions };
    }),

  setActiveTab: (sessionId) =>
    set(() => ({
      activeTabId: sessionId,
    })),

  setTabOrder: (order) => set({ tabOrder: order }),

  setSplitTree: (tree) => set({ splitTree: tree }),

  setTerminalTheme: (theme) => {
    try {
      localStorage.setItem('lunar-terminal-theme', theme);
    } catch {
      // localStorage may be unavailable
    }
    window.api.settings.set('terminal.theme', JSON.stringify(theme));
    set({ terminalTheme: theme });
  },
  setFontSize: (size) => {
    const clamped = clampFontSize(size);
    try {
      localStorage.setItem('lunar-terminal-font-size', String(clamped));
    } catch {
      // localStorage may be unavailable
    }
    void window.api.settings.set('terminal.fontSize', JSON.stringify(clamped));
    set({ fontSize: clamped });
  },
  setScrollback: (lines) => set({ scrollback: lines }),

  renameTab: (sessionId, title) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, title });
      }
      return { sessions };
    }),

  closeTab: (sessionId) => {
    const session = get().sessions.get(sessionId);
    if (session?.type === 'local') {
      window.api.localTerminal.kill(sessionId);
    } else {
      window.api.ssh.disconnect(sessionId);
    }
    get().removeSession(sessionId);
  },

  closeOtherTabs: (sessionId) => {
    const { tabOrder, sessions } = get();
    const toClose = tabOrder.filter((id) => id !== sessionId);
    // Disconnect all first, then batch-remove from state
    for (const id of toClose) {
      const s = sessions.get(id);
      if (s?.type === 'local') {
        window.api.localTerminal.kill(id);
      } else {
        window.api.ssh.disconnect(id);
      }
    }
    set((s) => {
      const sessions = new Map(s.sessions);
      for (const id of toClose) sessions.delete(id);
      const newTabOrder = s.tabOrder.filter((id) => id === sessionId);
      return {
        sessions,
        tabOrder: newTabOrder,
        activeTabId: sessionId,
        splitTree: { type: 'terminal' as const, sessionId },
      };
    });
  },

  closeTabsToRight: (sessionId) => {
    const { tabOrder, sessions } = get();
    const idx = tabOrder.indexOf(sessionId);
    if (idx === -1) return;
    const toClose = tabOrder.slice(idx + 1);
    // Disconnect all first, then batch-remove from state
    for (const id of toClose) {
      const s = sessions.get(id);
      if (s?.type === 'local') {
        window.api.localTerminal.kill(id);
      } else {
        window.api.ssh.disconnect(id);
      }
    }
    set((s) => {
      const sessions = new Map(s.sessions);
      for (const id of toClose) sessions.delete(id);
      const newTabOrder = s.tabOrder.slice(0, idx + 1);
      const activeTabId = newTabOrder.includes(s.activeTabId ?? '')
        ? s.activeTabId
        : newTabOrder[newTabOrder.length - 1] || null;
      return {
        sessions,
        tabOrder: newTabOrder,
        activeTabId,
        splitTree: activeTabId ? { type: 'terminal' as const, sessionId: activeTabId } : null,
      };
    });
  },
}));
