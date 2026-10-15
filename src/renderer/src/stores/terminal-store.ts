import { LIMITS } from '@shared/constants';
import type { AppSettings } from '@shared/types/settings';
import type {
  PaneNode,
  SessionStatus,
  SplitDirection,
  TerminalThemeName,
} from '@shared/types/terminal';
import { toast } from 'sonner';
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

function getInitialScreenReaderMode(): boolean {
  return readPersisted(
    'luna-terminal-screen-reader',
    (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined),
    true,
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
        id: crypto.randomUUID(),
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

function updateSplitRatioInTree(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type !== 'split') return node;
  if (node.id === splitId) return { ...node, ratio };
  const left = updateSplitRatioInTree(node.children[0], splitId, ratio);
  const right = updateSplitRatioInTree(node.children[1], splitId, ratio);
  // Preserve identity when nothing below changed, so memoised SplitLayout
  // subtrees that don't contain the dragged divider skip re-rendering.
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
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

/**
 * The session that represents a tab: the first leaf of its pane tree.
 *
 * A tab's id is the id of the session it was *opened* with, and it keeps that
 * id for life — but that session can be closed out of a split while the tab
 * lives on. Code that looked the tab id up in `sessions` then found nothing:
 * the tab strip dropped the tab's header, and every "is this an SSH or a local
 * tab?" check fell through to its default and filed a local tab under SSH.
 * Resolve through the layout instead.
 */
export function getTabSession(
  state: Pick<TerminalState, 'sessions' | 'layouts'>,
  tabId: string,
): TerminalSession | undefined {
  const root = state.layouts.get(tabId);
  return state.sessions.get(root ? getFirstLeafSessionId(root) : tabId);
}

/**
 * 'local' or 'ssh' for a tab. Every pane in a tab shares its kind — a split
 * copies its parent's type — so the representative session decides.
 */
export function getTabKind(
  state: Pick<TerminalState, 'sessions' | 'layouts'>,
  tabId: string,
): 'ssh' | 'local' {
  return getTabSession(state, tabId)?.type === 'local' ? 'local' : 'ssh';
}

/** Tab ids of one kind, in tab order. */
export function selectTabsByKind(
  state: Pick<TerminalState, 'sessions' | 'layouts' | 'tabOrder'>,
  kind: 'ssh' | 'local',
): string[] {
  return state.tabOrder.filter((id) => getTabKind(state, id) === kind);
}

/**
 * The session a view is actually showing.
 *
 * `activeSessionId` is global across the SSH and Local views, and switching
 * view doesn't change it — so a view whose tabs don't contain it falls back to
 * its first tab (see TerminalViewContainer). Toolbar actions that used the raw
 * global id sent snippets, macros and CLI commands from the SSH view into a
 * hidden local shell.
 */
export function selectViewSessionId(
  state: Pick<TerminalState, 'sessions' | 'layouts' | 'tabOrder' | 'activeSessionId'>,
  kind: 'ssh' | 'local',
): string | null {
  const active = state.activeSessionId;
  if (active) {
    const tabId = findTabIdForSession(state.layouts, active);
    if (tabId && getTabKind(state, tabId) === kind) return active;
  }
  const first = selectTabsByKind(state, kind)[0];
  if (!first) return null;
  const root = state.layouts.get(first);
  return root ? getFirstLeafSessionId(root) : first;
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
  screenReaderMode: boolean;

  addSession: (session: TerminalSession) => void;
  /** Open (and focus) a new local shell tab; returns its session id. */
  openLocalSession: () => string;
  removeSession: (sessionId: string) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveSession: (sessionId: string) => void;
  setTabOrder: (order: string[]) => void;
  setTerminalTheme: (theme: TerminalThemeName) => void;
  setFontSize: (size: number) => void;
  setScrollback: (lines: number) => void;
  setScreenReaderMode: (enabled: boolean) => void;
  initializeSettings: (settings: {
    theme?: TerminalThemeName;
    fontSize?: number;
    scrollback?: number;
    screenReaderMode?: boolean;
  }) => void;
  renameTab: (sessionId: string, title: string) => void;
  closeTab: (sessionId: string) => void;
  closeOtherTabs: (sessionId: string) => void;
  closeTabsToRight: (sessionId: string) => void;
  splitSession: (targetSessionId: string, direction: SplitDirection) => void;
  updateSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  tabOrder: [],
  activeSessionId: null,
  layouts: new Map(),
  terminalTheme: getInitialTerminalTheme(),
  fontSize: getInitialFontSize(),
  scrollback: getInitialScrollback(),
  screenReaderMode: getInitialScreenReaderMode(),

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

  openLocalSession: () => {
    // Was spelled out identically in TerminalViewContainer and
    // LocalTerminalTabs; the PTY itself is spawned by LocalTerminalPane.
    const id = crypto.randomUUID();
    get().addSession({
      id,
      connectionId: 'local',
      connectionName: 'Local Terminal',
      status: 'connected',
      title: 'Local',
      type: 'local',
    });
    return id;
  },

  /** Drop a session from the store without touching its transport. */
  removeSession: (sessionId) => set((s) => detachSession(s, sessionId)),

  // No-op guard: every whole-Map subscriber re-renders when `sessions` gets a
  // new identity, and status events repeat (reconnect ticks, duplicate
  // 'connected'). An unknown id or an unchanged status now changes nothing.
  updateSessionStatus: (sessionId, status) =>
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session || session.status === status) return s;
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...session, status });
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
  setScreenReaderMode: (enabled) => {
    persistTerminalSetting(
      'luna-terminal-screen-reader',
      String(enabled),
      'terminal.screenReaderMode',
      enabled,
      'Failed to save screen reader setting',
    );
    set({ screenReaderMode: enabled });
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
      if (typeof settings.screenReaderMode === 'boolean') {
        updates.screenReaderMode = settings.screenReaderMode;
        writePersisted('luna-terminal-screen-reader', String(settings.screenReaderMode));
      }
      return updates;
    });
  },

  renameTab: (sessionId, title) =>
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session || session.title === title) return s;
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, { ...session, title });
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

    const newSessionId = crypto.randomUUID();

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

  updateSplitRatio: (tabId, splitId, ratio) => {
    set((s) => {
      const root = s.layouts.get(tabId);
      if (!root) return {};
      const updated = updateSplitRatioInTree(root, splitId, ratio);
      if (updated === root) return {};
      const newLayouts = new Map(s.layouts);
      newLayouts.set(tabId, updated);
      return { layouts: newLayouts };
    });
  },
}));

/** Selective store hook helpers to avoid unnecessary component re-renders */
export const useActiveSessionId = () => useTerminalStore((s) => s.activeSessionId);
export const useTerminalTheme = () => useTerminalStore((s) => s.terminalTheme);
export const useTerminalTabOrder = () => useTerminalStore((s) => s.tabOrder);
