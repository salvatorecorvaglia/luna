import { toastArgs } from '@shared/error-messages';
import type { WorkspacePreset } from '@shared/types/workspace';
import { AlertTriangle, LayoutGrid, Play, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DialogShell } from '@/components/common/DialogShell';
import { Button, EmptyState, IconButton, Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';

interface WorkspacePresetsDialogProps {
  open: boolean;
  onClose: () => void;
  onRestoreWorkspace?: (preset: WorkspacePreset) => void;
}

export function WorkspacePresetsDialog({
  open,
  onClose,
  onRestoreWorkspace,
}: WorkspacePresetsDialogProps) {
  // Deletion is permanent; confirm first (the trash button used to act on one click).
  /** A failed load, shown instead of the empty state it used to masquerade as. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDeleteWorkspaceId, setPendingDeleteWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspacePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const fetchWorkspaces = useCallback(async () => {
    try {
      const list = await getApi().workspaces.list();
      setWorkspaces(list);
      setLoadError(null);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchWorkspaces().finally(() => setLoading(false));
  }, [open, fetchWorkspaces]);

  const handleSaveCurrentWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) {
      toast.error('Preset name is required');
      return;
    }

    // Read at save time rather than subscribing to the whole session Map,
    // which re-rendered this dialog on every status tick of every session.
    const { sessions, activeSessionId } = useTerminalStore.getState();
    // SSH sessions that are live. Local shells carry the pseudo connection id
    // 'local', which restore then tried to connectToHost() — an error tab —
    // and dead sessions aren't part of the workspace the user is looking at.
    const connectedConnectionIds = Array.from(sessions.values())
      .filter(
        (s) =>
          s.type !== 'local' &&
          s.connectionId &&
          s.connectionId !== 'local' &&
          (s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting'),
      )
      .map((s) => s.connectionId);

    if (connectedConnectionIds.length === 0) {
      toast.error('No active sessions to save in workspace');
      return;
    }

    try {
      await getApi().workspaces.create({
        name: newPresetName.trim(),
        layout: {
          connectionIds: Array.from(new Set(connectedConnectionIds)),
          // The persisted field keeps its original name: workspace layouts are
          // stored as JSON in the DB, so renaming it here would silently drop
          // the active pane from every preset saved by an earlier build. The
          // store-side name was the inaccurate one — it always held a session
          // id — and that is what got corrected.
          activeTabId: activeSessionId ?? undefined,
        },
      });
      toast.success(`Saved workspace preset "${newPresetName}"`);
      setNewPresetName('');
      setShowSaveForm(false);
      fetchWorkspaces();
    } catch (err) {
      toast.error(...toastArgs(err, 'Failed to save workspace'));
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      await getApi().workspaces.delete(id);
      toast.success('Workspace preset deleted');
      fetchWorkspaces();
    } catch (err) {
      toast.error(...toastArgs(err, 'Failed to delete workspace'));
    }
  };

  const handleRestore = (preset: WorkspacePreset) => {
    if (onRestoreWorkspace) {
      onRestoreWorkspace(preset);
      toast.success(`Restoring workspace "${preset.name}"`);
      onClose();
    } else {
      toast.info(
        `Workspace "${preset.name}" contains ${preset.layout.connectionIds.length} saved connection(s)`,
      );
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="workspace-presets-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LayoutGrid className="size-5" />
          </div>
          <div>
            <h2 id="workspace-presets-dialog-title" className="text-base font-semibold">
              Workspace Layout Presets
            </h2>
            <p className="text-xs text-muted-foreground">
              Save current tab matrices and connection groups to restore in one click
            </p>
          </div>
        </div>

        <IconButton
          onClick={onClose}
          aria-label="Close dialog"
          title="Close"
          size="md"
          icon={<X className="size-4" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Saved Presets ({workspaces.length})
          </div>

          {!showSaveForm && (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Save className="size-3.5" />
              Save Current Layout
            </button>
          )}
        </div>

        {/* Save Form */}
        {showSaveForm && (
          <form
            onSubmit={handleSaveCurrentWorkspace}
            className="rounded-lg border border-border bg-accent/20 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-semibold">Save Current Open Layout</span>
              <button
                type="button"
                onClick={() => setShowSaveForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div>
              <label
                htmlFor="workspace-preset-name"
                className="block text-xs text-muted-foreground mb-1"
              >
                Preset Name
              </label>
              <input
                id="workspace-preset-name"
                type="text"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="e.g. Production Cluster Setup"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                <Save className="size-3.5" />
                Save Preset
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {loading && workspaces.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" label="Loading saved workspace presets…" />
          </div>
        ) : loadError && workspaces.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle />}
            title="Couldn't load workspace presets"
            description={loadError}
            action={
              <Button variant="outline" onClick={() => void fetchWorkspaces()}>
                Retry
              </Button>
            }
            className="rounded-xl border border-dashed border-border bg-accent/10 py-10"
          />
        ) : workspaces.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title="No workspace presets saved"
            description="Save your active multi-session window layouts to instantly reconnect and restore tab setups later."
            className="rounded-xl border border-dashed border-border bg-accent/10 py-10"
          />
        ) : (
          <div className="space-y-2.5">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-background p-3.5 shadow-2xs hover:border-primary/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">{w.name}</div>
                  <div className="text-2xs text-muted-foreground mt-0.5">
                    {w.layout.connectionIds.length} target connection(s) saved
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRestore(w)}
                    title="Restore workspace layout"
                    className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    <Play className="size-3.5" />
                    Launch
                  </button>

                  <button
                    type="button"
                    onClick={() => setPendingDeleteWorkspaceId(w.id)}
                    title="Delete preset"
                    aria-label="Delete preset"
                    className="rounded-md border border-destructive/20 bg-destructive/10 p-1.5 text-destructive-fg hover:bg-destructive/20 transition-colors cursor-pointer"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={pendingDeleteWorkspaceId !== null}
        title="Delete workspace preset?"
        message="This preset will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDeleteWorkspaceId) void handleDeleteWorkspace(pendingDeleteWorkspaceId);
          setPendingDeleteWorkspaceId(null);
        }}
        onCancel={() => setPendingDeleteWorkspaceId(null)}
      />
    </DialogShell>
  );
}
