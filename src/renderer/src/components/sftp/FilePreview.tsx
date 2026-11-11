import { LIMITS } from '@shared/constants';
import { isEditableContent } from '@shared/editor';
import { isPreviewImageMime } from '@shared/file-types';
import {
  Check,
  Copy,
  FileCode,
  FileImage,
  FileText,
  Play,
  Save,
  Search,
  WrapText,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { DialogShell } from '@/components/common/DialogShell';
import { IconButton, Spinner } from '@/components/ui';
import { useCopiedFlag } from '@/hooks/use-copied-flag';
import { PREVIEW_LINE_HEIGHT, usePreviewGutter } from '@/hooks/use-preview-gutter';
import { copyToClipboard } from '@/lib/clipboard';
import { MOD_KEY } from '@/lib/platform';
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

const isImageType = isPreviewImageMime;

export function FilePreview() {
  const file = useStorageStore((s) => s.previewFile);
  const revision = useStorageStore((s) => s.previewRevision);
  return file ? (
    <FilePreviewDocument key={revision} previewFile={file} revision={revision} />
  ) : null;
}

function FilePreviewDocument({
  previewFile,
  revision,
}: {
  previewFile: NonNullable<ReturnType<typeof useStorageStore.getState>['previewFile']>;
  revision: number;
}) {
  const setPreviewFile = useStorageStore((s) => s.setPreviewFile);
  const [editorContent, setEditorContent] = useState(previewFile.content);
  const savingRef = useRef(false);
  const readOnly = !isEditableContent(previewFile.content);
  const withinLimit = useMemo(() => isEditableContent(editorContent), [editorContent]);
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

  const gutter = usePreviewGutter(editorContent, wordWrap, textareaRef);
  useLayoutEffect(() => {
    if (gutterRef.current && textareaRef.current)
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
  }, [gutter.height, gutter.lines]);

  // Follow the bottom of the loaded document; this does not fetch remote changes.
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
    if (savingRef.current || readOnly || !withinLimit) return;
    savingRef.current = true;
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
      useStorageStore.getState().markPreviewSaved(revision, editorContent);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Save failed: ${msg}`);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [previewFile, editorContent, revision, readOnly, withinLimit]);

  const handleCopyAll = () => {
    void copyToClipboard(editorContent, 'Content copied to clipboard').then((ok) => {
      if (ok) markCopied();
    });
  };

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const previewOpen = previewFile !== null;
  useEffect(() => {
    if (!previewOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (showSearch) closeSearch();
        else setShowSearch(true);
      } else if (e.key === 'Escape' && showSearch) {
        // Escape closes the search bar only. Without stopping here the same
        // event went on to DialogShell's Escape handler and closed the whole
        // preview. A plain Escape (no search open) is left to DialogShell —
        // handling it here too ran handleClose twice.
        e.preventDefault();
        e.stopPropagation();
        closeSearch();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [previewOpen, showSearch, handleClose, closeSearch]);

  const lineCount = gutter.lineCount;

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

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLTextAreaElement>) => {
      if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
      gutter.sync();
    },
    [gutter.sync],
  );

  // Rendered through DialogShell rather than a hand-rolled overlay.
  //
  // This was a full-screen modal with no role, no aria-modal and no focus trap:
  // keyboard users could Tab straight out of it into the file panes behind. It
  // also slipped past both static guards in design-tokens.test.ts, because each
  // keys off a marker this file did not have — one looks for attachFocusTrap,
  // the other for DialogShell. A modal that opts out of the shared primitive is
  // exactly the modal those guards cannot see.
  if (!previewFile) return null;

  return (
    <>
      <DialogShell
        open
        onClose={handleClose}
        zLayer={Z.modal}
        layout="fullscreen"
        dismissOnOverlayClick
        ariaLabelledBy="file-preview-title"
        panelClassName="flex min-w-0 flex-1 flex-col rounded-xl border border-border/80 bg-card shadow-xl overflow-hidden"
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
            <span id="file-preview-title" className="text-sm font-medium text-foreground">
              {previewFile.name}
            </span>
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
                  onClick={() => {
                    if (showSearch) closeSearch();
                    else setShowSearch(true);
                  }}
                  aria-label="Search"
                  aria-pressed={showSearch}
                  className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 transition-colors cursor-pointer ${
                    showSearch
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                  }`}
                  title={`Search (${MOD_KEY}+F)`}
                >
                  <Search className="size-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => setWordWrap((v) => !v)}
                  aria-label="Word wrap"
                  aria-pressed={wordWrap}
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
                  aria-pressed={autoTail}
                  className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium border border-border/60 transition-colors cursor-pointer ${
                    autoTail
                      ? 'bg-success/20 text-success border-success/40'
                      : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                  }`}
                  title="Follow the bottom of this loaded preview; does not reload the file"
                >
                  <Play className="size-3.5" />
                  <span>Follow bottom</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyAll}
                  aria-label={copied ? 'Copied' : 'Copy all content'}
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
                  disabled={isSaving || !withinLimit}
                  className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? <Spinner size="xs" /> : <Save className="size-3" />}
                  <span>Save</span>
                </button>
              )}

            <IconButton
              onClick={handleClose}
              aria-label="Close preview"
              title="Close preview"
              size="md"
              icon={<X className="size-4" />}
            />
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
              aria-label="Search in file"
              placeholder="Search in file..."
              autoFocus
              className="flex-1 bg-transparent outline-none text-foreground text-xs"
            />
            {searchQuery && (
              <span className="text-2xs text-muted-foreground">
                {matchCount} match{matchCount !== 1 ? 'es' : ''}
              </span>
            )}
            <IconButton
              onClick={closeSearch}
              aria-label="Close file search"
              title="Close file search"
              icon={<X className="size-3.5" />}
            />
          </div>
        )}

        {(readOnly || !withinLimit) &&
          !isImageType(previewFile.type) &&
          previewFile.type !== 'application/pdf' && (
            <p role="status" className="px-4 py-2 text-xs text-warning">
              {readOnly ? 'Read-only preview.' : 'Text is too large to save.'} Editing is limited to{' '}
              {LIMITS.MAX_EDITABLE_BYTES / 1024} KiB. Download the file to edit it externally.
            </p>
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
                  No `sandbox` attribute, deliberately. Chromium refuses to run
                  its PDF viewer in any sandboxed frame — `sandbox=""` and
                  `sandbox="allow-scripts"` both render a blank white box
                  (verified against the built app) — so with it PDF preview
                  never worked. Isolation comes from elsewhere: a data: frame
                  gets an opaque origin, so it cannot reach this document, its
                  DOM or the preload bridge; PDFium renders out of process; and
                  top-level navigation and window.open are already locked down
                  in main. Do not switch to a blob: URL — that would be
                  same-origin with the app.
                */
            <iframe
              src={`data:application/pdf;base64,${previewFile.content}#toolbar=0`}
              className="h-full w-full rounded border-none bg-white"
              title={previewFile.name}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full font-mono text-xs leading-relaxed overflow-hidden bg-card/40">
              {/* Line Numbers Gutter */}
              <div
                ref={gutterRef}
                aria-hidden="true"
                className="select-none text-right pr-3 pl-4 py-4 bg-muted/5 text-muted-foreground/60 border-r border-border/20 font-mono min-w-[3.5rem] overflow-hidden"
              >
                <div style={{ height: gutter.height, position: 'relative' }}>
                  {gutter.lines.map((line) => (
                    <div
                      key={line.number}
                      data-line-number={line.number}
                      style={{
                        position: 'absolute',
                        top: line.top,
                        left: 0,
                        right: 0,
                        height: PREVIEW_LINE_HEIGHT,
                        lineHeight: `${PREVIEW_LINE_HEIGHT}px`,
                      }}
                    >
                      {line.number}
                    </div>
                  ))}
                </div>
              </div>

              {/* Editor Input */}
              <textarea
                ref={textareaRef}
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                onScroll={handleScroll}
                readOnly={readOnly}
                aria-label="File contents"
                className={`flex-1 h-full w-full resize-none bg-transparent px-4 py-4 outline-none border-none text-foreground/90 font-mono focus:ring-0 leading-relaxed overflow-y-auto ${
                  wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
                }`}
                style={{ lineHeight: `${PREVIEW_LINE_HEIGHT}px` }}
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
            {autoTail && <span className="text-success">Follow bottom ON</span>}
          </div>
        </div>
      </DialogShell>

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
  );
}
