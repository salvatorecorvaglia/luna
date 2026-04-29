import { create } from 'zustand'
import type { PaneNode, SessionStatus, TerminalThemeName } from '@shared/types/terminal'

const VALID_THEMES: TerminalThemeName[] = [
  'dracula',
  'nord',
  'tokyo-night',
  'solarized-dark',
  'gruvbox',
  'one-dark',
  'monokai'
]

function getInitialTerminalTheme(): TerminalThemeName {
  try {
    const saved = localStorage.getItem('lunar-terminal-theme')
    if (saved && (VALID_THEMES as string[]).includes(saved)) return saved as TerminalThemeName
  } catch {
    // localStorage may be unavailable
  }
  return 'dracula'
}

export interface TerminalSession {
  id: string
  connectionId: string
  connectionName: string
  status: SessionStatus
  title: string
}

interface TerminalState {
  sessions: Map<string, TerminalSession>
  tabOrder: string[]
  activeTabId: string | null
  splitTree: PaneNode | null
  terminalTheme: TerminalThemeName
  fontSize: number
  scrollback: number

  addSession: (session: TerminalSession) => void
  removeSession: (sessionId: string) => void
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void
  setActiveTab: (sessionId: string) => void
  setTabOrder: (order: string[]) => void
  setSplitTree: (tree: PaneNode | null) => void
  setTerminalTheme: (theme: TerminalThemeName) => void
  setFontSize: (size: number) => void
  setScrollback: (lines: number) => void
  renameTab: (sessionId: string, title: string) => void
  closeTab: (sessionId: string) => void
  closeOtherTabs: (sessionId: string) => void
  closeTabsToRight: (sessionId: string) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: new Map(),
  tabOrder: [],
  activeTabId: null,
  splitTree: null,
  terminalTheme: getInitialTerminalTheme(),
  fontSize: 14,
  scrollback: 10000,

  addSession: (session) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.set(session.id, session)
      const tabOrder = [...s.tabOrder, session.id]
      const splitTree: PaneNode = s.splitTree
        ? s.splitTree
        : { type: 'terminal', sessionId: session.id }
      return { sessions, tabOrder, activeTabId: session.id, splitTree }
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      sessions.delete(sessionId)
      const tabOrder = s.tabOrder.filter((id) => id !== sessionId)
      const activeTabId =
        s.activeTabId === sessionId ? tabOrder[tabOrder.length - 1] || null : s.activeTabId
      const splitTree =
        tabOrder.length === 0
          ? null
          : activeTabId
            ? { type: 'terminal' as const, sessionId: activeTabId }
            : null
      return { sessions, tabOrder, activeTabId, splitTree }
    }),

  updateSessionStatus: (sessionId, status) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, status })
      }
      return { sessions }
    }),

  setActiveTab: (sessionId) =>
    set(() => ({
      activeTabId: sessionId,
      splitTree: { type: 'terminal', sessionId }
    })),

  setTabOrder: (order) => set({ tabOrder: order }),

  setSplitTree: (tree) => set({ splitTree: tree }),

  setTerminalTheme: (theme) => {
    try {
      localStorage.setItem('lunar-terminal-theme', theme)
    } catch {
      // localStorage may be unavailable
    }
    window.api.settings.set('terminal.theme', JSON.stringify(theme))
    set({ terminalTheme: theme })
  },
  setFontSize: (size) => set({ fontSize: size }),
  setScrollback: (lines) => set({ scrollback: lines }),

  renameTab: (sessionId, title) =>
    set((s) => {
      const sessions = new Map(s.sessions)
      const session = sessions.get(sessionId)
      if (session) {
        sessions.set(sessionId, { ...session, title })
      }
      return { sessions }
    }),

  closeTab: (sessionId) => {
    window.api.ssh.disconnect(sessionId)
    get().removeSession(sessionId)
  },

  closeOtherTabs: (sessionId) => {
    const { tabOrder } = get()
    for (const id of tabOrder) {
      if (id !== sessionId) {
        window.api.ssh.disconnect(id)
        get().removeSession(id)
      }
    }
  },

  closeTabsToRight: (sessionId) => {
    const { tabOrder } = get()
    const idx = tabOrder.indexOf(sessionId)
    if (idx === -1) return
    const toClose = tabOrder.slice(idx + 1)
    for (const id of toClose) {
      window.api.ssh.disconnect(id)
      get().removeSession(id)
    }
  }
}))
