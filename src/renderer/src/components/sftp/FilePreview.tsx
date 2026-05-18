import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileCode, FileImage, FileText, X } from 'lucide-react';
import { Z } from '@/lib/z-layers';
import { useStorageStore } from '@/stores/storage-store';

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    sh: 'bash',
    bash: 'bash',
    md: 'markdown',
    sql: 'sql',
    toml: 'toml',
    pdf: 'pdf',
  };
  return map[ext || ''] || 'text';
}

function isImageType(type: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'].includes(type);
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15 } },
};

export function FilePreview() {
  const previewFile = useStorageStore((s) => s.previewFile);
  const setPreviewFile = useStorageStore((s) => s.setPreviewFile);

  // Close on Escape. Only attach the listener while a preview is open so
  // background keystrokes don't churn through it; the handler itself never
  // reads previewFile so there's no stale-closure concern.
  const previewOpen = previewFile !== null;
  useEffect(() => {
    if (!previewOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewFile(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewOpen, setPreviewFile]);

  return (
    <AnimatePresence>
      {previewFile && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.modal} bg-black/60 backdrop-blur-sm`}
            onClick={() => setPreviewFile(null)}
          />
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-2 ${Z.modal} flex flex-col rounded-xl border border-border/80 bg-card shadow-xl overflow-hidden sm:inset-8`}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="flex items-center gap-2.5">
                {isImageType(previewFile.type) ? (
                  <FileImage className="h-4 w-4 text-pink-400" />
                ) : previewFile.type === 'application/pdf' ? (
                  <FileText className="h-4 w-4 text-red-400" />
                ) : (
                  <FileCode className="h-4 w-4 text-green-400" />
                )}
                <span className="text-sm font-medium text-foreground">{previewFile.name}</span>
                <span className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {detectLanguage(previewFile.name)}
                </span>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="btn-icon"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {isImageType(previewFile.type) ? (
                <div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(#80808012_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
                  <img
                    src={`data:${previewFile.type};base64,${previewFile.content}`}
                    alt={previewFile.name}
                    className="max-h-full max-w-full object-contain rounded"
                  />
                </div>
              ) : previewFile.type === 'application/pdf' ? (
                <iframe
                  src={`data:application/pdf;base64,${previewFile.content}#toolbar=0`}
                  className="h-full w-full rounded border-none bg-white"
                  title={previewFile.name}
                  // Sandbox: deny scripts, top-level navigation, popups, form
                  // submission, and same-origin access. A maliciously crafted
                  // PDF should be unable to execute JavaScript or escape the
                  // frame even if Chromium's PDF viewer has a flaw.
                  sandbox=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-full overflow-auto p-4">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">
                    {previewFile.content}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
