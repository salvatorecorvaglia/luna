import { BookOpen, Circle, Code, FileText, Filter, LayoutGrid, Radio } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuditExportDialog } from '@/components/terminal/AuditExportDialog';
import { BroadcastInputBar } from '@/components/terminal/BroadcastInputBar';
import { CliReferenceDialog } from '@/components/terminal/CliReferenceDialog';
import { MacroRecorderDialog } from '@/components/terminal/MacroRecorderDialog';
import { SnippetVaultDialog } from '@/components/terminal/SnippetVaultDialog';
import { TerminalFilterBar } from '@/components/terminal/TerminalFilterBar';
import { WorkspacePresetsDialog } from '@/components/terminal/WorkspacePresetsDialog';
import { IconButton } from '@/components/ui';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import { getApi } from '@/services/api';
import { useActiveSessionId, useTerminalStore } from '@/stores/terminal-store';

/**
 * Trigger buttons plus their on-demand dialogs for the terminal tab bar's
 * toolbar actions (snippets, broadcast, filter, macro recorder, CLI
 * reference, audit export, workspace presets). Split out of TerminalTabs so
 * the tab-bar component isn't also responsible for seven independent dialog
 * lifecycles.
 */

/**
 * Pressed state for the two toggle buttons.
 *
 * `!`-prefixed because `.btn-icon` is declared outside Tailwind's `@layer`
 * blocks in assets/main.css, so it wins over every utility class — the same
 * reason the size classes in IconButton use `!p-1` / `!p-1.5` / `!p-2`.
 */
const ACTIVE_TOGGLE = '!bg-primary/20 !text-primary';

export function TerminalToolbar() {
  const activeSessionId = useActiveSessionId();
  const sessions = useTerminalStore((s) => s.sessions);

  const [showSnippetVault, setShowSnippetVault] = useState(false);
  const [showBroadcastBar, setShowBroadcastBar] = useState(false);
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [showMacroRecorder, setShowMacroRecorder] = useState(false);
  const [showCliRef, setShowCliRef] = useState(false);
  const [showAuditExport, setShowAuditExport] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);

  // Shared by CliReferenceDialog, MacroRecorderDialog, and SnippetVaultDialog —
  // each just wants to type a line into whichever terminal is currently active.
  const sendData = (data: string) => {
    if (!activeSessionId) return;
    const session = sessions.get(activeSessionId);
    const result =
      session?.type === 'local'
        ? getApi().localTerminal.sendData({ sessionId: activeSessionId, data })
        : getApi().ssh.sendData({ sessionId: activeSessionId, data });
    result.catch(() => toast.error('Failed to send to terminal'));
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 border-l border-border/40">
        <IconButton
          onClick={() => setShowSnippetVault(true)}
          title="Snippet Vault & Scripts"
          aria-label="Snippet Vault & Scripts"
          icon={<Code className="size-3.5" />}
        />

        <IconButton
          onClick={() => setShowBroadcastBar((v) => !v)}
          className={cn(showBroadcastBar && ACTIVE_TOGGLE)}
          title="Broadcast Input to Multiple Terminals"
          aria-label="Broadcast Input to Multiple Terminals"
          aria-pressed={showBroadcastBar}
          icon={<Radio className="size-3.5" />}
        />

        <IconButton
          onClick={() => setShowFilterBar((v) => !v)}
          className={cn(showFilterBar && ACTIVE_TOGGLE)}
          title="Live Terminal Output Filter"
          aria-label="Live Terminal Output Filter"
          aria-pressed={showFilterBar}
          icon={<Filter className="size-3.5" />}
        />

        <IconButton
          onClick={() => setShowMacroRecorder(true)}
          title="Terminal Macro Recorder"
          aria-label="Terminal Macro Recorder"
          icon={<Circle className="size-3.5 text-destructive-fg/80" />}
        />

        <IconButton
          onClick={() => setShowCliRef(true)}
          title="Offline CLI Syntax & Flag Reference"
          aria-label="Offline CLI Syntax & Flag Reference"
          icon={<BookOpen className="size-3.5 text-primary/80" />}
        />

        <IconButton
          onClick={() => setShowAuditExport(true)}
          title="Export Session Audit Log (HTML/JSON/TXT)"
          aria-label="Export Session Audit Log (HTML, JSON or TXT)"
          icon={<FileText className="size-3.5 text-success/80" />}
        />

        <IconButton
          onClick={() => setShowWorkspaces(true)}
          title="Workspace Layout Presets"
          aria-label="Workspace Layout Presets"
          icon={<LayoutGrid className="size-3.5" />}
        />
      </div>

      {/* Gated behind their `show*` flag rather than always mounted: each of
          these seven dialogs already self-gates on `open` internally (so
          this changes nothing about when they're visible), but mounting them
          unconditionally meant every one of their hooks ran on every render
          of this tab bar even while closed. */}
      {showBroadcastBar && (
        <BroadcastInputBar open={showBroadcastBar} onClose={() => setShowBroadcastBar(false)} />
      )}
      {showFilterBar && (
        <TerminalFilterBar open={showFilterBar} onClose={() => setShowFilterBar(false)} />
      )}

      {showCliRef && (
        <CliReferenceDialog
          open={showCliRef}
          onClose={() => setShowCliRef(false)}
          onRunCommand={(cmd) => sendData(`${cmd}\n`)}
        />
      )}

      {showAuditExport && (
        <AuditExportDialog
          open={showAuditExport}
          onClose={() => setShowAuditExport(false)}
          sessionId={activeSessionId || ''}
          sessionTitle={
            activeSessionId
              ? sessions.get(activeSessionId)?.title ||
                sessions.get(activeSessionId)?.connectionName ||
                'Terminal Session'
              : 'Terminal Session'
          }
        />
      )}

      {showMacroRecorder && (
        <MacroRecorderDialog
          open={showMacroRecorder}
          onClose={() => setShowMacroRecorder(false)}
          onRunMacro={(sequence) => {
            for (const cmd of sequence) sendData(`${cmd}\n`);
          }}
        />
      )}

      {showSnippetVault && (
        <SnippetVaultDialog
          open={showSnippetVault}
          onClose={() => setShowSnippetVault(false)}
          onRunSnippet={(command) => sendData(`${command}\n`)}
        />
      )}

      {showWorkspaces && (
        <WorkspacePresetsDialog
          open={showWorkspaces}
          onClose={() => setShowWorkspaces(false)}
          onRestoreWorkspace={(preset) => {
            if (preset.layout.connectionIds && preset.layout.connectionIds.length > 0) {
              for (const connId of preset.layout.connectionIds) {
                connectToHost(connId);
              }
            }
          }}
        />
      )}
    </>
  );
}
