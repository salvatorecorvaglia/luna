import { ShieldAlert } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
// HostKeyDialog stays eager — it subscribes to host-key change IPC events on
// mount and must be alive at startup to catch the first one.
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

import { useSessionRecovery } from '@/hooks/use-session-recovery';
import { useTransferEventListener } from '@/hooks/use-transfers';
import { useUpdaterEventListener } from '@/hooks/use-updater';
import { applyUIThemeTokens, buildUIThemeTokens } from '@/themes/ui-from-terminal';

export default function App() {
  const activeView = useUIStore((s) => s.activeView);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const { tabOrder, terminalTheme, sessions } = useTerminalStore();

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
    void window.api.app.getCredentialBackend().then((status) => {
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
    const cleanup = window.api.credentials.onTamper((event) => {
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
    const cleanup = window.api.storage.onListTruncated((event) => {
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
      if (active) {
        const tag = active.tagName;
        const isFormField =
          (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) &&
          !active.closest('.xterm');
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

      // Cmd+Shift+1 — Switch to Local view
      if (mod && e.shiftKey && (e.code === 'Digit1' || e.key === '!')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('local');
      }

      // Cmd+Shift+2 — Switch to Terminal view
      if (mod && e.shiftKey && (e.code === 'Digit2' || e.key === '"' || e.key === '@')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('terminal');
      }

      // Cmd+Shift+3 — Switch to SFTP view
      if (mod && e.shiftKey && (e.code === 'Digit3' || e.key === '£' || e.key === '#')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('sftp');
      }

      // '?' — Toggle Shortcuts Help
      if (e.key === '?' && !mod) {
        // Only trigger if not in a form field (already handled by the isFormField check above)
        e.preventDefault();
        const store = useUIStore.getState();
        store.setShortcutsHelpOpen(!store.shortcutsHelpOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  const hasTerminals = useMemo(
    () =>
      tabOrder.some((id) => {
        const s = sessions.get(id);
        // biome-ignore lint/complexity/useOptionalChain: suppressed during migration
        return !s || !s.type || s.type === 'ssh';
      }),
    [tabOrder, sessions],
  );

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
        {everTerminal && (
          <div className={showTerminal ? 'h-full' : 'hidden'}>
            <Suspense fallback={null}>
              <TerminalView />
            </Suspense>
          </div>
        )}

        {everLocal && (
          <div className={showLocal ? 'h-full' : 'hidden'}>
            <Suspense fallback={null}>
              <LocalTerminalView />
            </Suspense>
          </div>
        )}

        {everSftp && (
          <div className={showSftp ? 'h-full' : 'hidden'}>
            <Suspense fallback={null}>
              <SftpManager />
            </Suspense>
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

      <Toaster
        theme="dark"
        position="bottom-right"
        visibleToasts={4}
        toastOptions={{
          className: 'text-sm',
        }}
        richColors={false}
        closeButton
      />
    </>
  );
}
