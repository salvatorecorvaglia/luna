import type { CliCommandDoc, CliCommandExample } from '@shared/types/cli-reference';
import { BookOpen, Copy, Play, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { EmptyState, Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

interface CliReferenceDialogProps {
  open: boolean;
  onClose: () => void;
  onRunCommand?: (cmd: string) => void;
}

export function CliReferenceDialog({ open, onClose, onRunCommand }: CliReferenceDialogProps) {
  const [docs, setDocs] = useState<CliCommandDoc[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchDocs = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = await getApi().shell.cliReference(q);
      setDocs(results);
    } catch (err) {
      console.error('CLI reference fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchDocs(query);
  }, [open, query, fetchDocs]);

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    toast.success('Command copied to clipboard');
  };

  const handleRun = (cmd: string) => {
    if (onRunCommand) {
      onRunCommand(cmd);
      toast.success('Sent to active terminal');
      onClose();
    } else {
      handleCopy(cmd);
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="cli-reference-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </div>
          <div>
            <h2 id="cli-reference-dialog-title" className="text-base font-semibold">
              Offline CLI Reference & Syntax Helper
            </h2>
            <p className="text-xs text-muted-foreground">
              Look up command syntax, flags, and common examples 100% offline
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Search bar */}
      <div className="p-4 border-b border-border/40">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search command (e.g. tar, find, rsync, docker, kubectl, ffmpeg)..."
            autoFocus
            className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading && docs.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" label="Loading CLI reference database…" />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState title={`No matching CLI documentation found for "${query}".`} />
        ) : (
          <div className="space-y-4">
            {docs.map((doc) => (
              <div
                key={doc.name}
                className="rounded-lg border border-border/80 bg-background p-4 space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-primary">{doc.name}</span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase font-medium text-muted-foreground">
                      {doc.category}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{doc.summary}</span>
                </div>

                <div className="text-xs font-mono bg-muted/40 p-2 rounded border border-border/40">
                  <span className="text-muted-foreground text-[11px] block mb-0.5">Syntax:</span>
                  <code>{doc.syntax}</code>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-foreground/90 block">
                    Common Examples:
                  </span>
                  {doc.examples.map((ex: CliCommandExample, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 rounded border border-border/60 bg-accent/20 p-2.5 text-xs font-mono"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-muted-foreground font-sans mb-0.5">
                          {ex.description}
                        </div>
                        <div className="text-foreground truncate">{ex.command}</div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopy(ex.command)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                          title="Copy command"
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRun(ex.command)}
                          className="flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 cursor-pointer"
                          title="Send to active terminal"
                        >
                          <Play className="size-3" />
                          Run
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
