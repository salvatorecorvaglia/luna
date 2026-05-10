import { useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { useUIStore } from '@/stores/ui-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnectionStore } from '@/stores/connection-store';
import { WelcomeView } from '@/components/common/WelcomeView';
import { ConnectionForm } from '@/components/connection/ConnectionForm';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { SettingsPanel } from '@/components/common/SettingsPanel';
import { HostKeyDialog } from '@/components/common/HostKeyDialog';
import { TerminalView } from '@/components/terminal/TerminalView';
import { LocalTerminalView } from '@/components/terminal/LocalTerminalView';
import { SftpManager } from '@/components/sftp/SftpManager';
import { useTransferEventListener } from '@/hooks/use-transfers';
import { useUpdaterEventListener } from '@/hooks/use-updater';
import { useSessionRecovery } from '@/hooks/use-session-recovery';
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
          { duration: 12000, icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" /> },
        );
      }
      setWarnedAboutBackend(true);
    });
    return () => {
      cancelled = true;
    };
  }, [warnedAboutBackend]);

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

      // Cmd+Shift+1 — Switch to Terminal view
      if (mod && e.shiftKey && (e.code === 'Digit1' || e.key === '!')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('terminal');
      }

      // Cmd+Shift+2 — Switch to SFTP view
      if (mod && e.shiftKey && (e.code === 'Digit2' || e.key === '@')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('sftp');
      }

      // Cmd+Shift+3 — Switch to Local Terminal view
      if (mod && e.shiftKey && (e.code === 'Digit3' || e.key === '#')) {
        e.preventDefault();
        useUIStore.getState().setActiveView('local');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  const hasTerminals = tabOrder.some((id) => {
    const s = sessions.get(id);
    return !s || !s.type || s.type === 'ssh';
  });

  const showTerminal = activeView === 'terminal' && hasTerminals;
  const showSftp = activeView === 'sftp';
  const showLocal = activeView === 'local';
  const showWelcome = !showTerminal && !showSftp && !showLocal;

  return (
    <>
      <AppShell>
        {/* Keep TerminalView mounted across view switches so xterm buffers/history survive */}
        <div className={showTerminal ? 'h-full' : 'hidden'}>
          <TerminalView />
        </div>

        {/* Keep LocalTerminalView mounted to preserve history and allow auto-spawn on view switch */}
        <div className={showLocal ? 'h-full' : 'hidden'}>
          <LocalTerminalView />
        </div>

        {showSftp && <SftpManager />}
        {showWelcome && <WelcomeView />}
      </AppShell>

      {/* Overlays */}
      <ConnectionForm />
      <CommandPalette />
      <SettingsPanel />
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
