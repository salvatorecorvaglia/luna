import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Copy,
  FileCode,
  FileImage,
  FileText,
  Loader2,
  Play,
  Save,
  Search,
  WrapText,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
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
    log: 'log',
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
} as const;

export function FilePreview() {
  const previewFile = useStorageStore((s) => s.previewFile);
  const setPreviewFile = useStorageStore((s) => s.setPreviewFile);

  const [editorContent, setEditorContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [autoTail, setAutoTail] = useState(false);
  const [copied, setCopied] = useState(false);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize editor content when a new file is previewed
  useEffect(() => {
    if (previewFile) {
      setEditorContent(previewFile.content);
    } else {
      setEditorContent('');
    }
  }, [previewFile]);

  // Auto tail scrolling
  useEffect(() => {
    if (autoTail && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [autoTail, editorContent]);

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

  const handleCopyAll = () => {
    navigator.clipboard.writeText(editorContent);
    setCopied(true);
    toast.success('Content copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const previewOpen = previewFile !== null;
  useEffect(() => {
    if (!previewOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch((v) => !v);
      } else if (e.key === 'Escape') {
        if (showSearch) {
          setShowSearch(false);
        } else {
          e.preventDefault();
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [previewOpen, showSearch, handleClose]);

  const lines = useMemo(() => editorContent.split('\n'), [editorContent]);

  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0;
    const q = searchQuery.toLowerCase();
    return lines.reduce((acc, line) => acc + (line.toLowerCase().split(q).length - 1), 0);
  }, [searchQuery, lines]);

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
            className={`fixed inset-0 ${Z.modal} bg-black/60 backdrop-blur-xs`}
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
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-2.5">
                {isImageType(previewFile.type) ? (
                  <FileImage className="size-4 text-brand-pink" />
                ) : previewFile.type === 'application/pdf' ? (
                  <FileText className="size-4 text-destructive" />
                ) : (
                  <FileCode className="size-4 text-success" />
                )}
                <span className="text-sm font-medium text-foreground">{previewFile.name}</span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                  {detectLanguage(previewFile.name)}
                </span>
                {isDirty && (
                  <span className="text-[10px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-md">
                    Modified
                  </span>
                )}
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2">
                {!isImageType(previewFile.type) && previewFile.type !== 'application/pdf' && (
                  <>
                    <button
                      onClick={() => setShowSearch((v) => !v)}
                      className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 transition-colors cursor-pointer ${
                        showSearch
                          ? 'bg-primary/20 text-primary border-primary/40'
                          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                      }`}
                      title="Search (Cmd+F / Ctrl+F)"
                    >
                      <Search className="size-3.5" />
                    </button>

                    <button
                      onClick={() => setWordWrap((v) => !v)}
                      className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 transition-colors cursor-pointer ${
                        wordWrap
                          ? 'bg-primary/20 text-primary border-primary/40'
                          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                      }`}
                      title="Toggle Word Wrap"
                    >
                      <WrapText className="size-3.5" />
                    </button>

                    <button
                      onClick={() => setAutoTail((v) => !v)}
                      className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 transition-colors cursor-pointer ${
                        autoTail
                          ? 'bg-success/20 text-success border-success/40'
                          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                      }`}
                      title="Auto Tail (Live Scroll to Bottom)"
                    >
                      <Play className="size-3.5" />
                      <span>Tail</span>
                    </button>

                    <button
                      onClick={handleCopyAll}
                      className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      title="Copy All Content"
                    >
                      {copied ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </>
                )}

                {!isImageType(previewFile.type) &&
                  previewFile.type !== 'application/pdf' &&
                  isDirty && (
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
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                  aria-label="Close preview"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Search Bar Overlay */}
            {showSearch && (
              <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2 text-xs">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in file..."
                  autoFocus
                  className="flex-1 bg-transparent outline-none text-foreground text-xs"
                />
                {searchQuery && (
                  <span className="text-[11px] text-muted-foreground">
                    {matchCount} match{matchCount !== 1 ? 'es' : ''}
                  </span>
                )}
                <button
                  onClick={() => setShowSearch(false)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

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
                    ref={textareaRef}
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    onScroll={handleScroll}
                    disabled={isSaving}
                    className={`flex-1 h-full w-full resize-none bg-transparent px-4 py-4 outline-none border-none text-foreground/90 font-mono focus:ring-0 leading-relaxed overflow-y-auto ${
                      wordWrap
                        ? 'whitespace-pre-wrap word-break-all'
                        : 'whitespace-pre overflow-x-auto'
                    }`}
                    style={{ lineHeight: '1.25rem' }}
                    placeholder="Enter text..."
                  />
                </div>
              )}
            </div>

            {/* Footer Bar */}
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-1.5 bg-muted/20 text-[11px] text-muted-foreground font-mono">
              <div>
                Lines: {lines.length} | Size: {editorContent.length} chars
              </div>
              <div className="flex items-center gap-3">
                {wordWrap && <span>Wrap ON</span>}
                {autoTail && <span className="text-success">Tail ON</span>}
              </div>
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
