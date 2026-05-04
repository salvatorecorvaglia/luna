import {create} from 'zustand'

export type ActiveView = 'terminal' | 'sftp'

// Enable smooth theme transitions after initial load
if (typeof document !== 'undefined') {
  requestAnimationFrame(() => document.documentElement.classList.add('theme-transition'))
}

function getInitialApplyTerminalThemeToUI(): boolean {
  try {
    const saved = localStorage.getItem('lunar-ui-themed')
    if (saved === 'true') return true
    if (saved === 'false') return false
  } catch {
    // localStorage may be unavailable
  }
  return true
}

interface UIState {
  sidebarOpen: boolean
  sidebarWidth: number
  commandPaletteOpen: boolean
  activeView: ActiveView
  settingsOpen: boolean
  applyTerminalThemeToUI: boolean

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  toggleCommandPalette: () => void
  setCommandPaletteOpen: (open: boolean) => void
  setActiveView: (view: ActiveView) => void
  setSettingsOpen: (open: boolean) => void
  setApplyTerminalThemeToUI: (value: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  commandPaletteOpen: false,
  activeView: 'terminal',
  settingsOpen: false,
  applyTerminalThemeToUI: getInitialApplyTerminalThemeToUI(),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setActiveView: (view) => set({ activeView: view }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setApplyTerminalThemeToUI: (value) => {
    try {
      localStorage.setItem('lunar-ui-themed', value ? 'true' : 'false')
    } catch {
      // localStorage may be unavailable
    }
    window.api.settings.set('ui.applyTerminalTheme', JSON.stringify(value))
    set({ applyTerminalThemeToUI: value })
  }
}))
