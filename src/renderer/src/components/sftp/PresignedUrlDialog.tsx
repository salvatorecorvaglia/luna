import { Check, Copy, Link2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

interface PresignedUrlDialogProps {
  open: boolean;
  entry: { name: string; path: string } | null;
  sessionId: string;
  onClose: () => void;
}

export function PresignedUrlDialog({ open, entry, sessionId, onClose }: PresignedUrlDialogProps) {
  const [expiryType, setExpiryType] = useState<'1m' | '1h' | '1d' | '7d' | 'custom'>('1h');
  const [customSeconds, setCustomSeconds] = useState('3600');
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setExpiryType('1h');
      setCustomSeconds('3600');
      setGeneratedUrl('');
      setCopied(false);
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!entry) return;
    setGenerating(true);
    setGeneratedUrl('');
    setCopied(false);

    let expiresSec = 3600;
    if (expiryType === '1m') expiresSec = 60;
    else if (expiryType === '1d') expiresSec = 86400;
    else if (expiryType === '7d') expiresSec = 604800;
    else if (expiryType === 'custom') {
      const parsed = parseInt(customSeconds, 10);
      expiresSec = Number.isNaN(parsed) || parsed <= 0 ? 3600 : parsed;
    }

    try {
      const url = await getApi().s3.generatePresignedUrl({
        sessionId,
        path: entry.path,
        expiresSec,
      });
      setGeneratedUrl(url);
      toast.success('Presigned URL generated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to generate URL: ${message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Copied URL to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <DialogShell
      open={open && entry !== null}
      onClose={onClose}
      zLayer={Z.confirm}
      dismissOnOverlayClick
      ariaLabelledBy="presigned-dialog-title"
      panelClassName="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-xl"
    >
      {/* Guarded so the exit-animation instance still has the last entry's
          content — see HostKeyDialog for why this can't just rely on `open`. */}
      {entry && (
        <>
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h3
              id="presigned-dialog-title"
              className="text-sm font-semibold text-foreground flex items-center gap-1.5"
            >
              <Link2 className="size-4 text-primary" />
              Generate Presigned URL
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <span
                id="presign-file-name-label"
                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80"
              >
                File Name
              </span>
              <div
                role="group"
                aria-labelledby="presign-file-name-label"
                className="mt-1 text-xs text-foreground bg-accent/30 rounded-lg p-2 border border-border/40 truncate"
              >
                {entry.name}
              </div>
            </div>

            {!generatedUrl ? (
              <>
                <div>
                  <span
                    id="presign-link-expiry-duration-label"
                    className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block mb-1.5"
                  >
                    Link Expiry Duration
                  </span>
                  <div
                    role="group"
                    aria-labelledby="presign-link-expiry-duration-label"
                    className="grid grid-cols-5 gap-2"
                  >
                    {(['1m', '1h', '1d', '7d'] as const).map((type) => {
                      const label =
                        type === '1m'
                          ? '1 Min'
                          : type === '1h'
                            ? '1 Hour'
                            : type === '1d'
                              ? '1 Day'
                              : '7 Days';
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setExpiryType(type)}
                          className={`rounded-lg border px-2 py-1.5 text-center text-xs font-semibold cursor-pointer ${
                            expiryType === type
                              ? 'border-ring bg-accent text-foreground shadow-xs'
                              : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setExpiryType('custom')}
                      className={`rounded-lg border px-2 py-1.5 text-center text-xs font-semibold cursor-pointer ${
                        expiryType === 'custom'
                          ? 'border-ring bg-accent text-foreground shadow-xs'
                          : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50'
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {expiryType === 'custom' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="presign-expiry-time-seconds"
                      className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block"
                    >
                      Expiry Time (Seconds)
                    </label>
                    <input
                      id="presign-expiry-time-seconds"
                      type="number"
                      min={1}
                      value={customSeconds}
                      onChange={(e) => setCustomSeconds(e.target.value)}
                      className="form-input text-xs w-full bg-background"
                      placeholder="e.g. 3600"
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <span
                  id="presign-generated-time-limited-url-label"
                  className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 block"
                >
                  Generated Time-limited URL
                </span>
                <div
                  role="group"
                  aria-labelledby="presign-generated-time-limited-url-label"
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    readOnly
                    value={generatedUrl}
                    className="form-input text-xs flex-1 bg-accent/10 border-border/80 select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="btn-outline shrink-0 flex items-center justify-center p-2.5 h-9 cursor-pointer"
                    title="Copy to Clipboard"
                  >
                    {copied ? (
                      <Check className="size-4 text-success" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                  Anyone with this URL can download this object until the signed authorization
                  expires.
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2 border-t border-border/40 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-outline h-8 px-4 text-xs font-semibold border-border/60 cursor-pointer"
            >
              Close
            </button>

            {!generatedUrl && (
              <button
                type="button"
                disabled={generating}
                onClick={handleGenerate}
                className="btn-primary h-8 px-4 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <Spinner size="sm" />
                    Generating...
                  </>
                ) : (
                  'Generate URL'
                )}
              </button>
            )}
          </div>
        </>
      )}
    </DialogShell>
  );
}
