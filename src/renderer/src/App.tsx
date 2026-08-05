import type { TerminalThemeName } from '@shared/types/terminal';
import { ShieldAlert } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
// HostKeyDialog stays eager — it subscribes to host-key change IPC events on
// mount and must be alive at startup to catch the first one.
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { HostKeyDialog } from '@/components/common/HostKeyDialog';
import { WelcomeView } from '@/components/common/WelcomeView';
import { AppShell } from '@/components/layout/AppShell';
import { useConnectionStore } from '@/stores/connection-store';
import { useStorageStore } from '@/stores/storage-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useUIStore } from '@/stores/ui-store';

// Overlays: chunk loads on first open. Each is gated on its store-managed
// `open` flag below so the chunk isn't fetched until the user triggers it.
const ConnectionForm = lazy(() =>
  import('@/components/connection/ConnectionForm').then((m) => ({ default: m.ConnectionForm })),
);
const CommandPalette = lazy(() =>
  import('@/components/command-palette/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  })),
);
const SettingsPanel = lazy(() =>
  import('@/components/common/SettingsPanel').then((m) => ({ default: m.SettingsPanel })),
);
const ShortcutsHelp = lazy(() =>
  import('@/components/common/ShortcutsHelp').then((m) => ({ default: m.ShortcutsHelp })),
);

// Views: lazy chunks loaded on first activation. After first visit each view
// stays mounted (just hidden via CSS) so xterm buffers, scroll position, and
// react-query caches survive view switches.
const TerminalView = lazy(() =>
  import('@/components/terminal/TerminalView').then((m) => ({ default: m.TerminalView })),
);
const LocalTerminalView = lazy(() =>
  import('@/components/terminal/LocalTerminalView').then((m) => ({
    default: m.LocalTerminalView,
  })),
);
const SftpManager = lazy(() =>
  import('@/components/sftp/SftpManager').then((m) => ({ default: m.SftpManager })),
);

import { useShallow } from 'zustand/react/shallow';
import { useSessionRecovery } from '@/hooks/use-session-recovery';
import { useTransferEventListener } from '@/hooks/use-transfers';
import { useUpdaterEventListener } from '@/hooks/use-updater';
import { getApi } from '@/services/api';
import { applyUIThemeTokens, buildUIThemeTokens } from '@/themes/ui-from-terminal';

/**
 * Physical key codes for the view-switch chords. Keyed by `KeyboardEvent.code`
 * so the binding is the same on every keyboard layout.
 */
const VIEW_SHORTCUT_CODES: Record<string, 'local' | 'terminal' | 'sftp'> = {
  Digit1: 'local',
  Digit2: 'terminal',
  Digit3: 'sftp',
};

export default function App() {
  const activeView = useUIStore((s) => s.activeView);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const { terminalTheme, initializeSettings } = useTerminalStore(
    useShallow((s) => ({
      terminalTheme: s.terminalTheme,
      initializeSettings: s.initializeSettings,
    })),
  );
  // Plain selector: the result is a boolean, and shallow-comparing a primitive
  // is just Object.is with extra indirection. useShallow only pays for itself
  // on object/array selections.
  const hasTerminals = useTerminalStore((s) =>
    s.tabOrder.some((id) => {
      const sess = s.sessions.get(id);
      return !sess?.type || sess.type === 'ssh';
    }),
  );

  // Load settings from DB on mount to prevent localStorage drift
  useEffect(() => {
    getApi()
      .settings.getAll()
      .then((settings) => {
        const theme = settings['terminal.theme'] as TerminalThemeName | undefined;
        const fontSize = settings['terminal.fontSize'] as number | undefined;
        const scrollback = settings['terminal.scrollback'] as number | undefined;
        initializeSettings({ theme, fontSize, scrollback });
      })
      .catch((err) => {
        console.error('Failed to load settings from DB:', err);
      });
  }, [initializeSettings]);

  // Apply terminal palette to UI tokens
  useEffect(() => {
    applyUIThemeTokens(buildUIThemeTokens(terminalTheme));
  }, [terminalTheme]);

  // Wire IPC transfer events into the Zustand store
  useTransferEventListener();

  // Wire IPC auto-update events into toast notifications
  useUpdaterEventListener();

  // Sync state with active sessions in main process (handles Cmd+R recovery)
  useSessionRecovery();

  // Surface a one-time toast if the credential store is using a plaintext
  // master key on disk (Linux without libsecret). Stored credentials are
  // recoverable by anyone with read access to the userData dir; the toast
  // makes this visible instead of leaving it buried in logs.
  const [warnedAboutBackend, setWarnedAboutBackend] = useState(false);
  useEffect(() => {
    if (warnedAboutBackend) return;
    let cancelled = false;
    void getApi()
      .app.getCredentialBackend()
      .then((status) => {
        if (cancelled) return;
        if (status.backend === 'plaintext') {
          toast.warning(
            'Credentials are stored with a plaintext master key on this machine. Install gnome-keyring or libsecret-1-0 and restart to migrate to OS-protected storage.',
            { duration: 12000, icon: <ShieldAlert className="size-4" aria-hidden="true" /> },
          );
        } else if (status.backend === 'inMemory') {
          toast.warning(
            'OS-level secret storage is unavailable. Saving connection passwords is disabled. Install gnome-keyring or libsecret-1-0 and restart to enable.',
            { duration: 12000, icon: <ShieldAlert className="size-4" aria-hidden="true" /> },
          );
        }
        setWarnedAboutBackend(true);
      });
    return () => {
      cancelled = true;
    };
  }, [warnedAboutBackend]);

  // Surface credential-tamper events as a security toast so an operator sees
  // a corrupted or attacker-modified credential row immediately rather than
  // discovering it via a broken connection attempt.
  useEffect(() => {
    const cleanup = getApi().credentials.onTamper((event) => {
      toast.error(
        `Stored credential for ${event.connectionId.slice(0, 8)}… could not be decrypted and was dropped. Re-enter it in the connection form.`,
        {
          duration: 16000,
          icon: <ShieldAlert className="size-4" aria-hidden="true" />,
          description: event.reason,
        },
      );
    });
    return cleanup;
  }, []);

  // Surface S3 list truncation. The S3 provider caps any single prefix at
  // LIMITS.MAX_S3_LIST_ENTRIES to keep main from OOMing on millions-of-keys
  // buckets; without this toast the user sees a normal-looking listing and
  // has no way to know they need to drill into a sub-prefix to see the rest.
  useEffect(() => {
    const cleanup = getApi().storage.onListTruncated((event) => {
      useStorageStore.getState().setPathTruncated(event.sessionId, event.path, true);
      toast.warning(
        `Showing the first ${event.returned.toLocaleString()} entries of ${event.path}. The bucket has more — open a sub-prefix to see them.`,
        { duration: 8000 },
      );
    });
    return cleanup;
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Don't hijack typing in form inputs. Allow xterm's hidden helper
      // textarea through — that textarea backs the terminal and the user
      // expects Cmd+K etc. to still work while focused on a terminal.
      const target = e.target as HTMLElement | null;
      const active = (document.activeElement as HTMLElement | null) ?? target;
      const inTerminal = Boolean(active?.closest('.xterm'));
      if (active) {
        const tag = active.tagName;
        const isFormField =
          (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) && !inTerminal;
        if (isFormField) return;
      }

      // Cmd+K: Command palette
      if (mod && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      // Cmd+B: Toggle sidebar
      if (mod && e.key === 'b') {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
      }

      // Cmd+,: Settings
      if (mod && e.key === ',') {
        e.preventDefault();
        useUIStore.getState().setSettingsOpen(true);
      }

      // Cmd+N: New connection
      if (mod && e.key === 'n') {
        e.preventDefault();
        useConnectionStore.getState().openCreateForm();
      }

      // Cmd+Shift+1/2/3 — switch view.
      //
      // Matched on `e.code` (physical key) only. The previous version also
      // accepted the shifted *characters* (`!`, `"`, `@`, `£`, `#`), which on
      // layouts where those sit unshifted meant a plain Cmd+@ silently
      // switched views mid-typing. `e.code` is layout-independent and is
      // exactly what a "Cmd+Shift+2" label promises.
      if (mod && e.shiftKey) {
        const viewForCode = VIEW_SHORTCUT_CODES[e.code];
        if (viewForCode) {
          e.preventDefault();
          useUIStore.getState().setActiveView(viewForCode);
          return;
        }
      }

      // '?' — Toggle Shortcuts Help.
      //
      // Deliberately excluded inside a terminal: the isFormField guard above
      // lets xterm's helper textarea through so Cmd-chords keep working, but
      // '?' is an ordinary printable character. Swallowing it meant you could
      // not type a question mark into a remote shell.
      if (e.key === '?' && !mod && !inTerminal) {
        e.preventDefault();
        const store = useUIStore.getState();
        store.setShortcutsHelpOpen(!store.shortcutsHelpOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  const showTerminal = activeView === 'terminal' && hasTerminals;
  const showSftp = activeView === 'sftp';
  const showLocal = activeView === 'local';
  const showWelcome = !showTerminal && !showSftp && !showLocal;

  // "Ever visited" gates each view's first mount until the user activates it.
  // Once mounted the view stays in the DOM (hidden via CSS) so xterm buffers,
  // scroll positions, and react-query caches survive view switches. Latched
  // during render (React's documented one-way-state-from-props pattern) so
  // the chunk fetch fires on the same paint that flips activeView.
  const [everTerminal, setEverTerminal] = useState(false);
  const [everSftp, setEverSftp] = useState(false);
  const [everLocal, setEverLocal] = useState(false);
  if (showTerminal && !everTerminal) setEverTerminal(true);
  if (showSftp && !everSftp) setEverSftp(true);
  if (showLocal && !everLocal) setEverLocal(true);

  // Overlay open flags. Reading at this level lets us conditionally mount the
  // lazy components, which is what defers the chunk fetch until first open.
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutsHelpOpen = useUIStore((s) => s.shortcutsHelpOpen);
  const connectionFormOpen = useConnectionStore((s) => s.connectionFormOpen);

  return (
    <>
      <AppShell>
        {/* Each view gets its own boundary. With only the root-level one, a
            render crash in (say) the SFTP browser blanked the entire window
            — including working terminal sessions the user could otherwise
            have kept using while the broken view stayed contained. */}
        {everTerminal && (
          <div className={showTerminal ? 'h-full' : 'hidden'}>
            <ErrorBoundary viewName="Terminal">
              <Suspense fallback={null}>
                <TerminalView />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {everLocal && (
          <div className={showLocal ? 'h-full' : 'hidden'}>
            <ErrorBoundary viewName="Local terminal">
              <Suspense fallback={null}>
                <LocalTerminalView />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {everSftp && (
          <div className={showSftp ? 'h-full' : 'hidden'}>
            <ErrorBoundary viewName="File browser">
              <Suspense fallback={null}>
                <SftpManager />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}

        {showWelcome && <WelcomeView />}
      </AppShell>

      {/* Overlays — each lazy chunk loads on first open. */}
      {connectionFormOpen && (
        <Suspense fallback={null}>
          <ConnectionForm />
        </Suspense>
      )}
      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel />
        </Suspense>
      )}
      {shortcutsHelpOpen && (
        <Suspense fallback={null}>
          <ShortcutsHelp />
        </Suspense>
      )}
      <HostKeyDialog />

      {/*
        Toasts inherit the app's own tokens rather than sonner's built-in
        "dark" palette. Every other surface derives its colors from the active
        terminal theme via applyUIThemeTokens, so a hardcoded theme made the
        toaster the one element that didn't follow the user's choice.
      */}
      <Toaster
        position="bottom-right"
        visibleToasts={4}
        toastOptions={{
          className: 'text-sm',
          style: {
            background: 'var(--color-card)',
            color: 'var(--color-foreground)',
            border: '1px solid var(--color-border)',
          },
        }}
        richColors={false}
        closeButton
      />
    </>
  );
}
