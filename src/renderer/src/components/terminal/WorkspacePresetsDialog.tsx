import type { WorkspacePreset } from '@shared/types/workspace';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutGrid, Play, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
import { useTerminalStore } from '@/stores/terminal-store';

interface WorkspacePresetsDialogProps {
  open: boolean;
  onClose: () => void;
  onRestoreWorkspace?: (preset: WorkspacePreset) => void;
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.1 } },
} as const;

export function WorkspacePresetsDialog({
  open,
  onClose,
  onRestoreWorkspace,
}: WorkspacePresetsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [workspaces, setWorkspaces] = useState<WorkspacePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const list = await getApi().workspaces.list();
      setWorkspaces(list);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchWorkspaces().finally(() => setLoading(false));
  }, [open, fetchWorkspaces]);

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    return attachFocusTrap(dialog, { onEscape: onClose });
  }, [open, onClose]);

  const handleSaveCurrentWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) {
      toast.error('Preset name is required');
      return;
    }

    const connectedConnectionIds = Array.from(sessions.values())
      .filter((s) => s.connectionId)
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
      toast.error(`Failed to save workspace: ${(err as Error).message}`);
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      await getApi().workspaces.delete(id);
      toast.success('Workspace preset deleted');
      fetchWorkspaces();
    } catch (err) {
      toast.error(`Failed to delete workspace: ${(err as Error).message}`);
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

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: Z.modal }}
      >
        <motion.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-xs"
        />

        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-presets-dialog-title"
          variants={dialogVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="relative flex flex-col w-full max-w-xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
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

            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Saved Presets ({workspaces.length})
              </div>

              {!showSaveForm && (
                <button
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
              <div className="py-8 text-center text-xs text-muted-foreground">
                Loading saved workspace presets...
              </div>
            ) : workspaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border rounded-xl bg-accent/10 p-6">
                <LayoutGrid className="size-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium">No workspace presets saved</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                  Save your active multi-session window layouts to instantly reconnect and restore
                  tab setups later.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {workspaces.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-background p-3.5 shadow-2xs hover:border-primary/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {w.layout.connectionIds.length} target connection(s) saved
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleRestore(w)}
                        title="Restore workspace layout"
                        className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                      >
                        <Play className="size-3.5" />
                        Launch
                      </button>

                      <button
                        onClick={() => handleDeleteWorkspace(w.id)}
                        title="Delete preset"
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
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
