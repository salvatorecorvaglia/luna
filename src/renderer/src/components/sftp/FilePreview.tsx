import { AnimatePresence, motion } from 'framer-motion';
import { FileCode, FileImage, FileText, Loader2, Save, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Z } from '@/lib/z-layers';
import { useStorageStore } from '@/stores/storage-store';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { toast } from 'sonner';

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

  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const gutterRef = useRef<HTMLDivElement>(null);

  // Initialize editor content when a new file is previewed
  useEffect(() => {
    if (previewFile) {
      setEditorContent(previewFile.content);
    } else {
      setEditorContent('');
    }
  }, [previewFile]);

  const isDirty = useMemo(() => {
    return previewFile ? editorContent !== previewFile.content : false;
  }, [previewFile, editorContent]);

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      setPreviewFile(null);
    }
  }, [isDirty, setPreviewFile]);

  const handleSave = useCallback(async () => {
    if (!previewFile) return;
    setIsSaving(true);
    try {
      if (previewFile.isLocal) {
        await window.api.shell.writeFile(previewFile.path, editorContent);
      } else {
        if (!previewFile.sessionId) throw new Error('No active session to save remote file');
        await window.api.storage.writeFile({
          sessionId: previewFile.sessionId,
          path: previewFile.path,
          content: editorContent,
        });
      }
      toast.success('File saved successfully');
      setPreviewFile({
        ...previewFile,
        content: editorContent,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }, [previewFile, editorContent, setPreviewFile]);

  // Close on Escape. Only attach the listener while a preview is open so
  // background keystrokes don't churn through it.
  const previewOpen = previewFile !== null;
  useEffect(() => {
    if (!previewOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [previewOpen, handleClose]);

  const lines = useMemo(() => editorContent.split('\n'), [editorContent]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

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
            onClick={handleClose}
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
                  <FileImage className="size-4 text-brand-pink" />
                ) : previewFile.type === 'application/pdf' ? (
                  <FileText className="size-4 text-destructive" />
                ) : (
                  <FileCode className="size-4 text-success" />
                )}
                <span className="text-sm font-medium text-foreground">{previewFile.name}</span>
                <span className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {detectLanguage(previewFile.name)}
                </span>
                {isDirty && (
                  <span className="text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded-md">
                    Modified
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isImageType(previewFile.type) && previewFile.type !== 'application/pdf' && isDirty && (
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Save className="size-3" />
                    )}
                    <span>Save</span>
                  </button>
                )}
                <button
                  onClick={handleClose}
                  className="btn-icon"
                  aria-label="Close preview"
                >
                  <X className="size-4" />
                </button>
              </div>
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
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full font-mono text-xs leading-relaxed overflow-hidden bg-card/40">
                  {/* Line Numbers Gutter */}
                  <div
                    ref={gutterRef}
                    className="select-none text-right pr-3 pl-4 py-4 bg-muted/5 text-muted-foreground/30 border-r border-border/20 font-mono min-w-[3.5rem] overflow-hidden"
                  >
                    {lines.map((_, i) => (
                      <div
                        key={i}
                        className="text-right"
                        style={{ height: '1.25rem', lineHeight: '1.25rem' }}
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Editor Input */}
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    onScroll={handleScroll}
                    disabled={isSaving}
                    className="flex-1 h-full w-full resize-none bg-transparent px-4 py-4 outline-none border-none text-foreground/90 font-mono focus:ring-0 leading-relaxed overflow-y-auto"
                    style={{ lineHeight: '1.25rem' }}
                    placeholder="Enter text..."
                  />
                </div>
              )}
            </div>
          </motion.div>

          <ConfirmDialog
            open={showConfirmClose}
            title="Unsaved Changes"
            message="You have unsaved changes. Discarding them will lose all edits. Are you sure?"
            confirmLabel="Discard"
            destructive
            onConfirm={() => {
              setShowConfirmClose(false);
              setPreviewFile(null);
            }}
            onCancel={() => setShowConfirmClose(false)}
          />
        </>
      )}
    </AnimatePresence>
  );
}
