import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Save, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { attachFocusTrap } from '@/lib/focus-trap';
import { Z } from '@/lib/z-layers';

interface AuditExportDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  sessionTitle: string;
  bufferText?: string;
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

export function AuditExportDialog({
  open,
  onClose,
  sessionId,
  sessionTitle,
  bufferText = '',
}: AuditExportDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState<'txt' | 'html' | 'json'>('html');
  const [exporting, setExporting] = useState(false);

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    return attachFocusTrap(dialog, { onEscape: onClose });
  }, [open, onClose]);

  const handleExport = async () => {
    if (!sessionId) return;
    setExporting(true);

    try {
      const ext = format === 'html' ? 'html' : format === 'json' ? 'json' : 'txt';
      const defaultName = `audit-${sessionTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.${ext}`;

      const savePath = await window.api.shell.saveFileDialog({
        defaultPath: defaultName,
        filters: [{ name: `${format.toUpperCase()} Log File`, extensions: [ext] }],
        content: '',
      });

      if (!savePath) {
        setExporting(false);
        return;
      }

      await window.api.shell.exportAuditLog({
        sessionId,
        sessionTitle,
        bufferText,
        format,
        destinationPath: savePath,
      });

      toast.success(`Exported audit trail to ${savePath}`);
      onClose();
    } catch (err) {
      toast.error(`Audit export failed: ${(err as Error).message}`);
    } finally {
      setExporting(false);
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
          className="relative flex flex-col w-full max-w-md max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Session Audit Trail Exporter</h2>
                <p className="text-xs text-muted-foreground">
                  Export session log transcript into structured format
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
          <div className="flex-1 p-5 space-y-4 text-xs">
            <div className="rounded-lg border border-border bg-accent/20 p-3 space-y-1">
              <span className="text-muted-foreground text-[11px]">Active Session:</span>
              <div className="font-semibold text-foreground truncate">{sessionTitle}</div>
            </div>

            <div className="space-y-2">
              <label className="block text-muted-foreground">Select Export Format:</label>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setFormat('html')}
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-colors cursor-pointer ${
                    format === 'html'
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <span className="text-sm">HTML</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Formatted Log</span>
                </button>

                <button
                  onClick={() => setFormat('json')}
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-colors cursor-pointer ${
                    format === 'json'
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <span className="text-sm">JSON</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Structured</span>
                </button>

                <button
                  onClick={() => setFormat('txt')}
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-colors cursor-pointer ${
                    format === 'txt'
                      ? 'border-primary bg-primary/10 text-primary font-semibold'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <span className="text-sm font-mono">TXT</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Plain Transcript</span>
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3 bg-muted/20 text-xs">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-accent transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Save className="size-3.5" />
              Save Audit File
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
