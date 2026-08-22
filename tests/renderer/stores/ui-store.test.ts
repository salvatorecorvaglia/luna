// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '../../../src/renderer/src/stores/ui-store';

describe('ui-store', () => {
  beforeEach(() => {
    useUIStore.setState({
      sidebarOpen: true,
      sidebarWidth: 260,
      commandPaletteOpen: false,
      activeView: 'terminal',
      settingsOpen: false,
      sidebarSectionOrder: ['ssh', 's3'],
      shortcutsHelpOpen: false,
      showHiddenConnections: false,
    });
  });

  it('toggleSidebar flips sidebarOpen', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('setSidebarOpen sets an explicit value', () => {
    useUIStore.getState().setSidebarOpen(false);
    expect(useUIStore.getState().sidebarOpen).toBe(false);
  });

  describe('setSidebarWidth clamping', () => {
    it('clamps below the minimum to 180', () => {
      useUIStore.getState().setSidebarWidth(50);
      expect(useUIStore.getState().sidebarWidth).toBe(180);
    });

    it('clamps above the maximum to 600', () => {
      useUIStore.getState().setSidebarWidth(9999);
      expect(useUIStore.getState().sidebarWidth).toBe(600);
    });

    it('rounds a fractional value within bounds', () => {
      useUIStore.getState().setSidebarWidth(300.6);
      expect(useUIStore.getState().sidebarWidth).toBe(301);
    });

    it('passes through an in-range integer unchanged', () => {
      useUIStore.getState().setSidebarWidth(400);
      expect(useUIStore.getState().sidebarWidth).toBe(400);
    });
  });

  it('toggleCommandPalette flips commandPaletteOpen', () => {
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);

    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('setCommandPaletteOpen sets an explicit value', () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('setActiveView updates the active view', () => {
    useUIStore.getState().setActiveView('sftp');
    expect(useUIStore.getState().activeView).toBe('sftp');
  });

  it('setSettingsOpen updates the settings panel visibility', () => {
    useUIStore.getState().setSettingsOpen(true);
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it('setSidebarSectionOrder replaces the section order', () => {
    useUIStore.getState().setSidebarSectionOrder(['s3', 'ssh']);
    expect(useUIStore.getState().sidebarSectionOrder).toEqual(['s3', 'ssh']);
  });

  it('setShortcutsHelpOpen updates the shortcuts-help visibility', () => {
    useUIStore.getState().setShortcutsHelpOpen(true);
    expect(useUIStore.getState().shortcutsHelpOpen).toBe(true);
  });

  it('toggleShowHiddenConnections flips showHiddenConnections', () => {
    useUIStore.getState().toggleShowHiddenConnections();
    expect(useUIStore.getState().showHiddenConnections).toBe(true);

    useUIStore.getState().toggleShowHiddenConnections();
    expect(useUIStore.getState().showHiddenConnections).toBe(false);
  });
});
