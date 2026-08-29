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
import { useCopiedFlag } from '@/hooks/use-copied-flag';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
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

/**
 * Line height for the gutter, in px. Must stay in lockstep with the textarea's
 * `lineHeight: '1.25rem'` (20px at the default root size) or the numbers drift
 * out of alignment with the text as you scroll.
 */
const GUTTER_LINE_HEIGHT_PX = 20;
/** Extra rows rendered above/below the viewport to hide scroll tearing. */
const GUTTER_OVERSCAN = 10;

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
  const { copied, markCopied } = useCopiedFlag();

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
        await getApi().shell.writeFile(previewFile.path, editorContent);
      } else {
        if (!previewFile.sessionId) throw new Error('No active session to save remote file');
        await getApi().storage.writeFile({
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
    toast.success('Content copied to clipboard');
    markCopied();
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

  // Line *count* is all the gutter needs; splitting a 5 MB file into an array
  // of strings just to read `.length` allocated the whole document a second
  // time on every keystroke.
  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < editorContent.length; i++) {
      if (editorContent.charCodeAt(i) === 10) count++;
    }
    return count;
  }, [editorContent]);

  const matchCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return 0;
    // Single pass with indexOf instead of split() per line: split allocated an
    // array per line, per keystroke, over the entire file.
    const haystack = editorContent.toLowerCase();
    let count = 0;
    let idx = haystack.indexOf(q);
    while (idx !== -1) {
      count++;
      idx = haystack.indexOf(q, idx + q.length);
    }
    return count;
  }, [searchQuery, editorContent]);

  // Only the line numbers actually on screen are rendered. MAX_PREVIEW_BYTES
  // is 5 MB, so a log file can easily be 100k+ lines — one <div> each meant
  // 100k DOM nodes for decoration that is never more than ~40 rows visible.
  const [gutterScrollTop, setGutterScrollTop] = useState(0);
  const [gutterHeight, setGutterHeight] = useState(0);

  const visibleLines = useMemo(() => {
    if (gutterHeight === 0) return { start: 0, end: Math.min(lineCount, 80) };
    const start = Math.max(
      0,
      Math.floor(gutterScrollTop / GUTTER_LINE_HEIGHT_PX) - GUTTER_OVERSCAN,
    );
    const visible = Math.ceil(gutterHeight / GUTTER_LINE_HEIGHT_PX) + GUTTER_OVERSCAN * 2;
    return { start, end: Math.min(lineCount, start + visible) };
  }, [gutterScrollTop, gutterHeight, lineCount]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, clientHeight } = e.currentTarget;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
    setGutterScrollTop(scrollTop);
    setGutterHeight(clientHeight);
  }, []);

  // Seed the viewport height once the textarea is laid out, so the gutter is
  // correct before the user scrolls for the first time.
  useEffect(() => {
    if (!previewFile) return;
    const el = textareaRef.current;
    if (el) setGutterHeight(el.clientHeight);
  }, [previewFile]);

  return (
    <AnimatePresence>
      {previewFile && (
        <>
          <motion.div
            key="overlay"
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.modal} bg-black/60 backdrop-blur-xs`}
            onClick={handleClose}
          />
          <motion.div
            key="panel"
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
                  <FileText className="size-4 text-destructive-fg" />
                ) : (
                  <FileCode className="size-4 text-success" />
                )}
                <span className="text-sm font-medium text-foreground">{previewFile.name}</span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-3xs font-medium text-muted-foreground uppercase">
                  {detectLanguage(previewFile.name)}
                </span>
                {isDirty && (
                  <span className="text-3xs font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-md">
                    Modified
                  </span>
                )}
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2">
                {!isImageType(previewFile.type) && previewFile.type !== 'application/pdf' && (
                  <>
                    <button
                      type="button"
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
                      type="button"
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
                      type="button"
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
                      type="button"
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
                      type="button"
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
                  type="button"
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
                  <span className="text-2xs text-muted-foreground">
                    {matchCount} match{matchCount !== 1 ? 'es' : ''}
                  </span>
                )}
                <button
                  type="button"
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
                /*
                  Empty sandbox: the PDF viewer is a browser-native plugin and
                  needs no script execution from the framed document. The
                  previous `allow-scripts` granted a capability the preview
                  never used, on content fetched from a remote server.
                */
                <iframe
                  src={`data:application/pdf;base64,${previewFile.content}#toolbar=0`}
                  className="h-full w-full rounded border-none bg-white"
                  title={previewFile.name}
                  sandbox=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full font-mono text-xs leading-relaxed overflow-hidden bg-card/40">
                  {/* Line Numbers Gutter */}
                  <div
                    ref={gutterRef}
                    aria-hidden="true"
                    className="select-none text-right pr-3 pl-4 py-4 bg-muted/5 text-muted-foreground/30 border-r border-border/20 font-mono min-w-[3.5rem] overflow-hidden"
                  >
                    {/* Spacer preserves total scroll height; only the visible
                        window of numbers is materialised. */}
                    <div
                      style={{ height: lineCount * GUTTER_LINE_HEIGHT_PX, position: 'relative' }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: visibleLines.start * GUTTER_LINE_HEIGHT_PX,
                          left: 0,
                          right: 0,
                        }}
                      >
                        {Array.from(
                          { length: visibleLines.end - visibleLines.start },
                          (_, i) => visibleLines.start + i,
                        ).map((lineIndex) => (
                          <div
                            key={lineIndex}
                            className="text-right"
                            style={{
                              height: GUTTER_LINE_HEIGHT_PX,
                              lineHeight: `${GUTTER_LINE_HEIGHT_PX}px`,
                            }}
                          >
                            {lineIndex + 1}
                          </div>
                        ))}
                      </div>
                    </div>
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
                    style={{ lineHeight: `${GUTTER_LINE_HEIGHT_PX}px` }}
                    placeholder="Enter text..."
                  />
                </div>
              )}
            </div>

            {/* Footer Bar */}
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-1.5 bg-muted/20 text-2xs text-muted-foreground font-mono">
              <div>
                Lines: {lineCount.toLocaleString()} | Size: {editorContent.length.toLocaleString()}{' '}
                chars
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
