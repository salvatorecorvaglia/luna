import { BookOpen, Circle, Code, FileText, Filter, LayoutGrid, Radio } from 'lucide-react';
import { useState } from 'react';
import { AuditExportDialog } from '@/components/terminal/AuditExportDialog';
import { BroadcastInputBar } from '@/components/terminal/BroadcastInputBar';
import { CliReferenceDialog } from '@/components/terminal/CliReferenceDialog';
import { MacroRecorderDialog } from '@/components/terminal/MacroRecorderDialog';
import { SnippetVaultDialog } from '@/components/terminal/SnippetVaultDialog';
import { TerminalFilterBar } from '@/components/terminal/TerminalFilterBar';
import { WorkspacePresetsDialog } from '@/components/terminal/WorkspacePresetsDialog';
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
    if (session?.type === 'local') {
      getApi().localTerminal.sendData({ sessionId: activeSessionId, data });
    } else {
      getApi().ssh.sendData({ sessionId: activeSessionId, data });
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 border-l border-border/40">
        <button
          onClick={() => setShowSnippetVault(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Snippet Vault & Scripts"
        >
          <Code className="size-3.5" />
        </button>

        <button
          onClick={() => setShowBroadcastBar((v) => !v)}
          className={cn(
            'rounded p-1 transition-colors cursor-pointer',
            showBroadcastBar
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          title="Broadcast Input to Multiple Terminals"
        >
          <Radio className="size-3.5" />
        </button>

        <button
          onClick={() => setShowFilterBar((v) => !v)}
          className={cn(
            'rounded p-1 transition-colors cursor-pointer',
            showFilterBar
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          title="Live Terminal Output Filter"
        >
          <Filter className="size-3.5" />
        </button>

        <button
          onClick={() => setShowMacroRecorder(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Terminal Macro Recorder"
        >
          <Circle className="size-3.5 text-destructive-fg/80" />
        </button>

        <button
          onClick={() => setShowCliRef(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Offline CLI Syntax & Flag Reference"
        >
          <BookOpen className="size-3.5 text-primary/80" />
        </button>

        <button
          onClick={() => setShowAuditExport(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Export Session Audit Log (HTML/JSON/TXT)"
        >
          <FileText className="size-3.5 text-success/80" />
        </button>

        <button
          onClick={() => setShowWorkspaces(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Workspace Layout Presets"
        >
          <LayoutGrid className="size-3.5" />
        </button>
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
