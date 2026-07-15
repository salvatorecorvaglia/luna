import { LIMITS } from '@shared/constants';
import type { PaneNode, SessionStatus, SplitDirection, TerminalThemeName } from '@shared/types/terminal';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';

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

export function hasSessionInTree(node: PaneNode | undefined, sessionId: string): boolean {
  if (!node) return false;
  if (node.type === 'terminal') {
    return node.sessionId === sessionId;
  }
  return hasSessionInTree(node.children[0], sessionId) || hasSessionInTree(node.children[1], sessionId);
}

export function getFirstLeafSessionId(node: PaneNode): string {
  if (node.type === 'terminal') {
    return node.sessionId;
  }
  return getFirstLeafSessionId(node.children[0]);
}

export function getAllSessionIdsFromTree(node: PaneNode): string[] {
  if (node.type === 'terminal') {
    return [node.sessionId];
  }
  return [...getAllSessionIdsFromTree(node.children[0]), ...getAllSessionIdsFromTree(node.children[1])];
}

function splitLeafInTree(node: PaneNode, targetId: string, direction: SplitDirection, newId: string): PaneNode {
  if (node.type === 'terminal') {
    if (node.sessionId === targetId) {
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [
          { type: 'terminal', sessionId: targetId },
          { type: 'terminal', sessionId: newId },
        ],
      };
    }
    return node;
  }
  return {
    ...node,
    children: [
      splitLeafInTree(node.children[0], targetId, direction, newId),
      splitLeafInTree(node.children[1], targetId, direction, newId),
    ] as [PaneNode, PaneNode],
  };
}

function removeLeafFromTree(node: PaneNode, targetId: string): PaneNode | null {
  if (node.type === 'terminal') {
    if (node.sessionId === targetId) {
      return null;
    }
    return node;
  }

  const left = removeLeafFromTree(node.children[0], targetId);
  const right = removeLeafFromTree(node.children[1], targetId);

  if (left === null && right === null) {
    return null;
  }
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }

  return {
    ...node,
    children: [left, right],
  };
}

function updateSplitRatioInTree(node: PaneNode, leftKey: string, ratio: number): PaneNode {
  if (node.type === 'split') {
    const key = getFirstLeafSessionId(node.children[0]);
    if (key === leftKey) {
      return {
        ...node,
        ratio,
      };
    }
    return {
      ...node,
      children: [
        updateSplitRatioInTree(node.children[0], leftKey, ratio),
        updateSplitRatioInTree(node.children[1], leftKey, ratio),
      ] as [PaneNode, PaneNode],
    };
  }
  return node;
}

export function findTabIdForSession(layouts: Map<string, PaneNode>, sessionId: string): string | null {
  for (const [tabId, node] of layouts.entries()) {
    if (hasSessionInTree(node, sessionId)) {
      return tabId;
    }
  }
  return null;
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  tabOrder: string[];
  activeTabId: string | null;
  layouts: Map<string, PaneNode>;
  terminalTheme: TerminalThemeName;
  fontSize: number;
  scrollback: number;

  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveTab: (sessionId: string) => void;
  setTabOrder: (order: string[]) => void;
  setTerminalTheme: (theme: TerminalThemeName) => void;
  setFontSize: (size: number) => void;
  setScrollback: (lines: number) => void;
  initializeSettings: (settings: {
    theme?: TerminalThemeName;
    fontSize?: number;
    scrollback?: number;
  }) => void;
  renameTab: (sessionId: string, title: string) => void;
  closeTab: (sessionId: string) => void;
  closeOtherTabs: (sessionId: string) => void;
  closeTabsToRight: (sessionId: string) => void;
  splitSession: (targetSessionId: string, direction: SplitDirection) => void;
  updateSplitRatio: (tabId: string, leftKey: string, ratio: number) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  tabOrder: [],
  activeTabId: null,
  layouts: new Map(),
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
      const layouts = new Map(s.layouts);
      layouts.set(session.id, { type: 'terminal', sessionId: session.id });
      return { sessions, tabOrder, activeTabId: session.id, layouts };
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const tabId = findTabIdForSession(s.layouts, sessionId);
      if (!tabId) {
        // Fallback for non-layout sessions (e.g. tests or custom initial sessions)
        const sessions = new Map(s.sessions);
        sessions.delete(sessionId);
        const tabOrder = s.tabOrder.filter((id) => id !== sessionId);
        const activeTabId =
          s.activeTabId === sessionId ? tabOrder[tabOrder.length - 1] || null : s.activeTabId;
        return { sessions, tabOrder, activeTabId };
      }

      const sessions = new Map(s.sessions);
      sessions.delete(sessionId);

      const layouts = new Map(s.layouts);
      const updatedLayout = removeLeafFromTree(layouts.get(tabId)!, sessionId);
      let tabOrder = [...s.tabOrder];
      let activeTabId = s.activeTabId;

      if (updatedLayout === null) {
        tabOrder = tabOrder.filter((id) => id !== tabId);
        layouts.delete(tabId);

        if (activeTabId === sessionId || (activeTabId && !sessions.has(activeTabId))) {
          const nextTabId = tabOrder[tabOrder.length - 1] || null;
          activeTabId = nextTabId ? getFirstLeafSessionId(layouts.get(nextTabId)!) : null;
        }
      } else {
        layouts.set(tabId, updatedLayout);
        if (activeTabId === sessionId) {
          activeTabId = getFirstLeafSessionId(updatedLayout);
        }
      }

      return { sessions, tabOrder, activeTabId, layouts };
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

  setTerminalTheme: (theme) => {
    try {
      localStorage.setItem('lunar-terminal-theme', theme);
    } catch {
      // localStorage may be unavailable
    }
    void window.api.settings.set('terminal.theme', JSON.stringify(theme));
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
  initializeSettings: (settings) => {
    set(() => {
      const updates: Partial<TerminalState> = {};
      if (settings.theme) {
        updates.terminalTheme = settings.theme;
        try {
          localStorage.setItem('lunar-terminal-theme', settings.theme);
        } catch {
          // ignore
        }
      }
      if (settings.fontSize) {
        const clamped = clampFontSize(settings.fontSize);
        updates.fontSize = clamped;
        try {
          localStorage.setItem('lunar-terminal-font-size', String(clamped));
        } catch {
          // ignore
        }
      }
      if (settings.scrollback) {
        updates.scrollback = settings.scrollback;
      }
      return updates;
    });
  },

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
    let type: 'ssh' | 'local' | undefined;
    set((s) => {
      type = s.sessions.get(sessionId)?.type;
      const tabId = findTabIdForSession(s.layouts, sessionId);
      if (!tabId) {
        // Fallback for sessions not in layout (tests)
        const sessions = new Map(s.sessions);
        sessions.delete(sessionId);
        const tabOrder = s.tabOrder.filter((id) => id !== sessionId);
        const activeTabId =
          s.activeTabId === sessionId ? tabOrder[tabOrder.length - 1] || null : s.activeTabId;
        return { sessions, tabOrder, activeTabId };
      }

      const sessions = new Map(s.sessions);
      sessions.delete(sessionId);

      const layouts = new Map(s.layouts);
      const updatedLayout = removeLeafFromTree(layouts.get(tabId)!, sessionId);
      let tabOrder = [...s.tabOrder];
      let activeTabId = s.activeTabId;

      if (updatedLayout === null) {
        tabOrder = tabOrder.filter((id) => id !== tabId);
        layouts.delete(tabId);

        if (activeTabId === sessionId || (activeTabId && !sessions.has(activeTabId))) {
          const nextTabId = tabOrder[tabOrder.length - 1] || null;
          activeTabId = nextTabId ? getFirstLeafSessionId(layouts.get(nextTabId)!) : null;
        }
      } else {
        layouts.set(tabId, updatedLayout);
        if (activeTabId === sessionId) {
          activeTabId = getFirstLeafSessionId(updatedLayout);
        }
      }

      return { sessions, tabOrder, activeTabId, layouts };
    });

    if (type === 'local') {
      void window.api.localTerminal.kill(sessionId);
    } else {
      void window.api.ssh.disconnect(sessionId);
    }
  },

  closeOtherTabs: (sessionId) => {
    const { tabOrder, sessions, layouts } = get();
    const tabId = findTabIdForSession(layouts, sessionId);
    if (!tabId) return;

    const toCloseTabIds = tabOrder.filter((id) => id !== tabId);
    const toCloseSessionIds: string[] = [];
    for (const tId of toCloseTabIds) {
      const root = layouts.get(tId);
      if (root) {
        toCloseSessionIds.push(...getAllSessionIdsFromTree(root));
      }
    }

    for (const id of toCloseSessionIds) {
      const s = sessions.get(id);
      if (s?.type === 'local') {
        void window.api.localTerminal.kill(id);
      } else {
        void window.api.ssh.disconnect(id);
      }
    }

    set((s) => {
      const newSessions = new Map(s.sessions);
      for (const id of toCloseSessionIds) newSessions.delete(id);
      const newLayouts = new Map(s.layouts);
      for (const tId of toCloseTabIds) newLayouts.delete(tId);
      const newTabOrder = s.tabOrder.filter((id) => id === tabId);

      return {
        sessions: newSessions,
        layouts: newLayouts,
        tabOrder: newTabOrder,
        activeTabId: sessionId,
      };
    });
  },

  closeTabsToRight: (sessionId) => {
    const { tabOrder, sessions, layouts } = get();
    const tabId = findTabIdForSession(layouts, sessionId);
    if (!tabId) return;

    const idx = tabOrder.indexOf(tabId);
    if (idx === -1) return;
    const toCloseTabIds = tabOrder.slice(idx + 1);
    const toCloseSessionIds: string[] = [];
    for (const tId of toCloseTabIds) {
      const root = layouts.get(tId);
      if (root) {
        toCloseSessionIds.push(...getAllSessionIdsFromTree(root));
      }
    }

    for (const id of toCloseSessionIds) {
      const s = sessions.get(id);
      if (s?.type === 'local') {
        void window.api.localTerminal.kill(id);
      } else {
        void window.api.ssh.disconnect(id);
      }
    }

    set((s) => {
      const newSessions = new Map(s.sessions);
      for (const id of toCloseSessionIds) newSessions.delete(id);
      const newLayouts = new Map(s.layouts);
      for (const tId of toCloseTabIds) newLayouts.delete(tId);
      const newTabOrder = s.tabOrder.slice(0, idx + 1);

      const isStillActive = s.activeTabId && !toCloseSessionIds.includes(s.activeTabId);
      const activeTabId = isStillActive
        ? s.activeTabId
        : getFirstLeafSessionId(newLayouts.get(tabId)!);

      return {
        sessions: newSessions,
        layouts: newLayouts,
        tabOrder: newTabOrder,
        activeTabId,
      };
    });
  },

  splitSession: (targetSessionId, direction) => {
    const { sessions, layouts } = get();
    const parentSession = sessions.get(targetSessionId);
    if (!parentSession) return;

    const tabId = findTabIdForSession(layouts, targetSessionId);
    if (!tabId) return;

    const newSessionId = uuidv4();

    const newSession: TerminalSession = {
      id: newSessionId,
      connectionId: parentSession.connectionId,
      connectionName: parentSession.connectionName,
      status: parentSession.type === 'local' ? 'connected' : 'connecting',
      title: parentSession.type === 'local' ? 'Local' : parentSession.connectionName,
      type: parentSession.type,
    };

    set((s) => {
      const newSessions = new Map(s.sessions);
      newSessions.set(newSessionId, newSession);

      const newLayouts = new Map(s.layouts);
      const updatedLayout = splitLeafInTree(
        newLayouts.get(tabId)!,
        targetSessionId,
        direction,
        newSessionId,
      );
      newLayouts.set(tabId, updatedLayout);

      return {
        sessions: newSessions,
        layouts: newLayouts,
        activeTabId: newSessionId,
      };
    });

    if (parentSession.type !== 'local') {
      window.api.ssh
        .connect({
          connectionId: parentSession.connectionId,
          sessionId: newSessionId,
        })
        .catch((err) => {
          console.error('Failed to connect split SSH session:', err);
        });
    }
  },

  updateSplitRatio: (tabId, leftKey, ratio) => {
    set((s) => {
      const root = s.layouts.get(tabId);
      if (!root) return {};
      const newLayouts = new Map(s.layouts);
      newLayouts.set(tabId, updateSplitRatioInTree(root, leftKey, ratio));
      return { layouts: newLayouts };
    });
  },
}));
