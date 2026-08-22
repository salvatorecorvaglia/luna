import { LIMITS } from '@shared/constants';
import type { AppSettings } from '@shared/types/settings';
import type {
  PaneNode,
  SessionStatus,
  SplitDirection,
  TerminalThemeName,
} from '@shared/types/terminal';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { getApi } from '@/services/api';

/**
 * Read a persisted terminal setting from localStorage, falling back to
 * `fallback` when the key is missing, unreadable (localStorage disabled), or
 * fails `parse`'s validation (returns `undefined`).
 */
function readPersisted<T>(
  storageKey: string,
  parse: (raw: string) => T | undefined,
  fallback: T,
): T {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved != null) {
      const parsed = parse(saved);
      if (parsed !== undefined) return parsed;
    }
  } catch {
    // localStorage may be unavailable
  }
  return fallback;
}

/** Write a persisted terminal setting, silently no-op'ing if localStorage is unavailable. */
function writePersisted(storageKey: string, rawValue: string): void {
  try {
    localStorage.setItem(storageKey, rawValue);
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Mirror a terminal setting to both localStorage (for instant restore on the
 * next launch, before the main process round-trip completes) and the main
 * process's settings table (source of truth). Shared by all three terminal
 * settings — theme, font size, and scrollback previously hand-rolled this
 * exact pairing three times over.
 */
function persistTerminalSetting(
  storageKey: string,
  rawValue: string,
  settingsKey: keyof AppSettings,
  jsonValue: unknown,
  failureMessage: string,
): void {
  writePersisted(storageKey, rawValue);
  getApi()
    .settings.set(settingsKey, JSON.stringify(jsonValue))
    .catch(() => toast.error(failureMessage));
}

function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return LIMITS.DEFAULT_FONT_SIZE;
  return Math.min(LIMITS.MAX_FONT_SIZE, Math.max(LIMITS.MIN_FONT_SIZE, Math.round(size)));
}

function getInitialFontSize(): number {
  return readPersisted(
    'luna-terminal-font-size',
    (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clampFontSize(parsed) : undefined;
    },
    LIMITS.DEFAULT_FONT_SIZE,
  );
}

const VALID_THEMES: TerminalThemeName[] = [
  'dracula',
  'nord',
  'tokyo-night',
  'gruvbox',
  'one-dark',
  'monokai',
];

function clampScrollback(lines: number): number {
  if (!Number.isFinite(lines)) return DEFAULT_SCROLLBACK;
  return Math.min(LIMITS.MAX_SCROLLBACK, Math.max(LIMITS.MIN_SCROLLBACK, Math.round(lines)));
}

const DEFAULT_SCROLLBACK = 10000;

function getInitialScrollback(): number {
  return readPersisted(
    'luna-terminal-scrollback',
    (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? clampScrollback(parsed) : undefined;
    },
    DEFAULT_SCROLLBACK,
  );
}

function getInitialTerminalTheme(): TerminalThemeName {
  return readPersisted(
    'luna-terminal-theme',
    (raw) => ((VALID_THEMES as string[]).includes(raw) ? (raw as TerminalThemeName) : undefined),
    'dracula',
  );
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
  return (
    hasSessionInTree(node.children[0], sessionId) || hasSessionInTree(node.children[1], sessionId)
  );
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
  return [
    ...getAllSessionIdsFromTree(node.children[0]),
    ...getAllSessionIdsFromTree(node.children[1]),
  ];
}

function splitLeafInTree(
  node: PaneNode,
  targetId: string,
  direction: SplitDirection,
  newId: string,
): PaneNode {
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

export function findTabIdForSession(
  layouts: Map<string, PaneNode>,
  sessionId: string,
): string | null {
  for (const [tabId, node] of layouts.entries()) {
    if (hasSessionInTree(node, sessionId)) {
      return tabId;
    }
  }
  return null;
}

/** The slice of store state that detaching a session rewrites. */
type DetachResult = Pick<TerminalState, 'sessions' | 'tabOrder' | 'activeSessionId' | 'layouts'>;

/**
 * Remove one session from the store: drop it from `sessions`, prune its leaf
 * from the owning tab's pane tree, collapse the tab if that leaf was the last
 * one, and pick a sensible next active pane.
 *
 * `removeSession` and `closeTab` were byte-for-byte identical apart from the
 * IPC teardown call at the end; both now route through here so they cannot
 * disagree about which pane gets focus after a close.
 *
 * `closeOtherTabs` and `closeTabsToRight` drop whole tabs at once rather than
 * one leaf, so they don't fit this signature — see `detachTabs` below for
 * their shared logic.
 */
function detachSession(state: TerminalState, sessionId: string): DetachResult {
  const sessions = new Map(state.sessions);
  sessions.delete(sessionId);

  const tabId = findTabIdForSession(state.layouts, sessionId);
  if (!tabId) {
    // Session isn't in any layout (tests, or a session added before layouts
    // existed). Fall back to treating the session id as its own tab.
    const tabOrder = state.tabOrder.filter((id) => id !== sessionId);
    return {
      sessions,
      tabOrder,
      layouts: state.layouts,
      activeSessionId:
        state.activeSessionId === sessionId
          ? (tabOrder[tabOrder.length - 1] ?? null)
          : state.activeSessionId,
    };
  }

  const layouts = new Map(state.layouts);
  const updatedLayout = removeLeafFromTree(layouts.get(tabId)!, sessionId);
  let tabOrder = [...state.tabOrder];
  let activeSessionId = state.activeSessionId;

  if (updatedLayout === null) {
    // Last pane in the tab — the whole tab goes away.
    tabOrder = tabOrder.filter((id) => id !== tabId);
    layouts.delete(tabId);
    if (activeSessionId === sessionId || (activeSessionId && !sessions.has(activeSessionId))) {
      const nextTabId = tabOrder[tabOrder.length - 1] ?? null;
      const nextLayout = nextTabId ? layouts.get(nextTabId) : undefined;
      activeSessionId = nextLayout ? getFirstLeafSessionId(nextLayout) : null;
    }
  } else {
    layouts.set(tabId, updatedLayout);
    if (activeSessionId === sessionId) {
      activeSessionId = getFirstLeafSessionId(updatedLayout);
    }
  }

  return { sessions, tabOrder, activeSessionId, layouts };
}

/**
 * Compute the sessions/layouts/tabOrder that result from dropping a set of
 * whole tabs at once. Shared by `closeOtherTabs`/`closeTabsToRight`, which
 * agree on "drop these tabs" but disagree on how to pick the next active
 * session afterward — that part stays with each caller.
 */
function detachTabs(
  state: Pick<TerminalState, 'sessions' | 'layouts' | 'tabOrder'>,
  tabIdsToClose: string[],
): Pick<TerminalState, 'sessions' | 'layouts' | 'tabOrder'> & { closedSessionIds: string[] } {
  const closeSet = new Set(tabIdsToClose);
  const closedSessionIds: string[] = [];
  for (const tId of tabIdsToClose) {
    const root = state.layouts.get(tId);
    if (root) closedSessionIds.push(...getAllSessionIdsFromTree(root));
  }

  const sessions = new Map(state.sessions);
  for (const id of closedSessionIds) sessions.delete(id);
  const layouts = new Map(state.layouts);
  for (const tId of tabIdsToClose) layouts.delete(tId);
  const tabOrder = state.tabOrder.filter((id) => !closeSet.has(id));

  return { sessions, layouts, tabOrder, closedSessionIds };
}

/** Tear down the backing transport for a session, picking the right channel. */
function disposeTransport(session: TerminalSession | undefined, sessionId: string): void {
  if (session?.type === 'local') {
    void getApi().localTerminal.kill(sessionId);
  } else {
    void getApi().ssh.disconnect(sessionId);
  }
}

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  tabOrder: string[];
  activeSessionId: string | null;
  layouts: Map<string, PaneNode>;
  terminalTheme: TerminalThemeName;
  fontSize: number;
  scrollback: number;

  addSession: (session: TerminalSession) => void;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveSession: (sessionId: string) => void;
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
  activeSessionId: null,
  layouts: new Map(),
  terminalTheme: getInitialTerminalTheme(),
  fontSize: getInitialFontSize(),
  scrollback: getInitialScrollback(),

  addSession: (session) =>
    set((s) => {
      if (s.sessions.has(session.id)) {
        return { activeSessionId: session.id };
      }
      const sessions = new Map(s.sessions);
      sessions.set(session.id, session);
      const tabOrder = [...s.tabOrder, session.id];
      const layouts = new Map(s.layouts);
      layouts.set(session.id, { type: 'terminal', sessionId: session.id });
      return { sessions, tabOrder, activeSessionId: session.id, layouts };
    }),

  /** Drop a session from the store without touching its transport. */
  removeSession: (sessionId) => set((s) => detachSession(s, sessionId)),

  updateSessionStatus: (sessionId, status) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status });
      }
      return { sessions };
    }),

  setActiveSession: (sessionId) =>
    set(() => ({
      activeSessionId: sessionId,
    })),

  setTabOrder: (order) => set({ tabOrder: order }),

  setTerminalTheme: (theme) => {
    persistTerminalSetting(
      'luna-terminal-theme',
      theme,
      'terminal.theme',
      theme,
      'Failed to save terminal theme',
    );
    set({ terminalTheme: theme });
  },
  setFontSize: (size) => {
    const clamped = clampFontSize(size);
    persistTerminalSetting(
      'luna-terminal-font-size',
      String(clamped),
      'terminal.fontSize',
      clamped,
      'Failed to save terminal font size',
    );
    set({ fontSize: clamped });
  },
  setScrollback: (lines) => {
    const clamped = clampScrollback(lines);
    persistTerminalSetting(
      'luna-terminal-scrollback',
      String(clamped),
      'terminal.scrollback',
      clamped,
      'Failed to save terminal scrollback setting',
    );
    set({ scrollback: clamped });
  },
  initializeSettings: (settings) => {
    set(() => {
      const updates: Partial<TerminalState> = {};
      if (settings.theme) {
        updates.terminalTheme = settings.theme;
        writePersisted('luna-terminal-theme', settings.theme);
      }
      if (settings.fontSize) {
        const clamped = clampFontSize(settings.fontSize);
        updates.fontSize = clamped;
        writePersisted('luna-terminal-font-size', String(clamped));
      }
      if (settings.scrollback) {
        const clamped = clampScrollback(settings.scrollback);
        updates.scrollback = clamped;
        writePersisted('luna-terminal-scrollback', String(clamped));
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

  /** Close a session *and* tear down its SSH connection / local PTY. */
  closeTab: (sessionId) => {
    // Read the session before the store update removes it.
    const session = get().sessions.get(sessionId);
    set((s) => detachSession(s, sessionId));
    disposeTransport(session, sessionId);
  },

  closeOtherTabs: (sessionId) => {
    const { tabOrder, sessions, layouts } = get();
    const tabId = findTabIdForSession(layouts, sessionId);
    if (!tabId) return;

    const toCloseTabIds = tabOrder.filter((id) => id !== tabId);
    const next = detachTabs({ sessions, layouts, tabOrder }, toCloseTabIds);

    for (const id of next.closedSessionIds) {
      disposeTransport(sessions.get(id), id);
    }

    set({
      sessions: next.sessions,
      layouts: next.layouts,
      tabOrder: next.tabOrder,
      activeSessionId: sessionId,
    });
  },

  closeTabsToRight: (sessionId) => {
    const { tabOrder, sessions, layouts, activeSessionId: currentActive } = get();
    const tabId = findTabIdForSession(layouts, sessionId);
    if (!tabId) return;

    const idx = tabOrder.indexOf(tabId);
    if (idx === -1) return;
    const toCloseTabIds = tabOrder.slice(idx + 1);
    const next = detachTabs({ sessions, layouts, tabOrder }, toCloseTabIds);

    for (const id of next.closedSessionIds) {
      disposeTransport(sessions.get(id), id);
    }

    const isStillActive = currentActive && !next.closedSessionIds.includes(currentActive);
    const activeSessionId = isStillActive
      ? currentActive
      : getFirstLeafSessionId(next.layouts.get(tabId)!);

    set({
      sessions: next.sessions,
      layouts: next.layouts,
      tabOrder: next.tabOrder,
      activeSessionId,
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
        activeSessionId: newSessionId,
      };
    });

    if (parentSession.type !== 'local') {
      getApi()
        .ssh.connect({
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

/** Selective store hook helpers to avoid unnecessary component re-renders */
export const useActiveSessionId = () => useTerminalStore((s) => s.activeSessionId);
export const useTerminalTheme = () => useTerminalStore((s) => s.terminalTheme);
export const useTerminalTabOrder = () => useTerminalStore((s) => s.tabOrder);
