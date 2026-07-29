import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Copy, Play, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';
import type { CliCommandDoc, CliCommandExample } from '@shared/types/cli-reference';

interface CliReferenceDialogProps {
  open: boolean;
  onClose: () => void;
  onRunCommand?: (cmd: string) => void;
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
};

export function CliReferenceDialog({ open, onClose, onRunCommand }: CliReferenceDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [docs, setDocs] = useState<CliCommandDoc[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchDocs = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const results = await window.api.shell.cliReference(q);
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

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    return attachFocusTrap(dialog, { onEscape: onClose });
  }, [open, onClose]);

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
          variants={dialogVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BookOpen className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Offline CLI Reference & Syntax Helper</h2>
                <p className="text-xs text-muted-foreground">
                  Look up command syntax, flags, and common examples 100% offline
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
              <div className="py-8 text-center text-xs text-muted-foreground">
                Loading CLI reference database...
              </div>
            ) : docs.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No matching CLI documentation found for "{query}".
              </div>
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
                      <span className="text-xs font-semibold text-foreground/90 block">Common Examples:</span>
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
                              onClick={() => handleCopy(ex.command)}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                              title="Copy command"
                            >
                              <Copy className="size-3.5" />
                            </button>
                            <button
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
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
