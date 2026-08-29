import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveView = 'terminal' | 'sftp' | 'local' | 'welcome';

/**
 * Sidebar width bounds. Exported so the resize handle in `Sidebar` clamps to
 * the same range this store enforces — the two used to disagree ([200,400] in
 * the drag handler vs [180,600] here), so the drag could not reach widths the
 * store considered perfectly valid.
 */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 600;

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
  shortcutsHelpOpen: boolean;
  showHiddenConnections: boolean;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarSectionOrder: (order: string[]) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  toggleShowHiddenConnections: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarWidth: 260,
      // sidebar width bounds — clamp on every set so a corrupted localStorage
      // value can't collapse the sidebar past the rebind handle (180px) or
      // push it so wide it eats the editor (600px).
      commandPaletteOpen: false,
      activeView: 'terminal',
      settingsOpen: false,
      sidebarSectionOrder: ['ssh', 's3'],
      shortcutsHelpOpen: false,
      showHiddenConnections: false,

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) =>
        set({
          sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width))),
        }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setActiveView: (view) => set({ activeView: view }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSidebarSectionOrder: (order) => set({ sidebarSectionOrder: order }),
      setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
      toggleShowHiddenConnections: () =>
        set((s) => ({ showHiddenConnections: !s.showHiddenConnections })),
    }),
    {
      name: 'luna-ui-storage',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        sidebarSectionOrder: state.sidebarSectionOrder,
      }),
    },
  ),
);
