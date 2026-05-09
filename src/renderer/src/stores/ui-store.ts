import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveView = 'terminal' | 'sftp' | 'local' | 'welcome';

// Enable smooth theme transitions after initial load
if (typeof document !== 'undefined') {
  requestAnimationFrame(() => document.documentElement.classList.add('theme-transition'));
}

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  commandPaletteOpen: boolean;
  activeView: ActiveView;
  settingsOpen: boolean;
  sidebarSectionOrder: string[];

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarSectionOrder: (order: string[]) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 260,
      commandPaletteOpen: false,
      activeView: 'terminal',
      settingsOpen: false,
      sidebarSectionOrder: ['ssh', 's3'],

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setActiveView: (view) => set({ activeView: view }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSidebarSectionOrder: (order) => set({ sidebarSectionOrder: order }),
    }),
    {
      name: 'lunar-ui-storage',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        activeView: state.activeView,
        sidebarSectionOrder: state.sidebarSectionOrder,
      }),
    },
  ),
);
