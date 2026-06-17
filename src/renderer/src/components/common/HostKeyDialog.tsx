import { toastArgs } from '@shared/error-messages';
import type { SshHostKeyChangeEvent } from '@shared/types/terminal';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Fingerprint, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui';
import { attachFocusTrap } from '@/lib/focus-trap';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';

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

export function HostKeyDialog() {
  const [event, setEvent] = useState<SshHostKeyChangeEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = window.api.ssh.onHostKeyChange((payload: SshHostKeyChangeEvent) => {
      setEvent(payload);
      setLoading(false);
      setCopied(false);
    });
    return cleanup;
  }, []);

  const handleTrust = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    try {
      const result = await window.api.ssh.trustHostKey({
        host: event.host,
        port: event.port,
      });
      if (result.trusted) {
        toast.success(`Host key trusted for ${event.host}:${event.port}`);
        setEvent(null);
        // Auto-reconnect after trusting
        if (event.connectionId) {
          void connectToHost(event.connectionId);
        }
      } else {
        toast.error('Failed to trust host key');
      }
    } catch (err) {
      toast.error(...toastArgs(err, 'Trust failed'));
    } finally {
      setLoading(false);
    }
  }, [event]);

  const handleReject = useCallback(() => {
    setEvent(null);
    toast.info('Host key rejected — connection was not established');
  }, []);

  const handleCopyFingerprint = useCallback(async () => {
    if (!event) return;
    await navigator.clipboard.writeText(event.newFingerprint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [event]);

  // Focus trap + Escape
  useEffect(() => {
    if (!event) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    requestAnimationFrame(() => {
      const rejectBtn = dialog.querySelector<HTMLElement>('[data-reject]');
      rejectBtn?.focus();
    });

    return attachFocusTrap(dialog, { onEscape: handleReject });
  }, [event, handleReject]);

  return (
    <AnimatePresence>
      {event && (
        <>
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.hostKeyDialog} bg-black/60 backdrop-blur-sm`}
          />
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.hostKeyDialog} flex items-center justify-center p-4`}
          >
            {/** biome-ignore lint/a11y/useKeyWithClickEvents: suppressed during migration */}
            <div
              ref={dialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="host-key-dialog-title"
              aria-describedby="host-key-dialog-desc"
              className="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex size-10 flex-shrink-0 items-center justify-center rounded-full',
                    event.isFirst ? 'bg-info/10' : 'bg-destructive/10',
                  )}
                >
                  {event.isFirst ? (
                    <ShieldCheck className="size-5 text-info" />
                  ) : (
                    <ShieldAlert className="size-5 text-destructive" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 id="host-key-dialog-title" className="text-sm font-semibold text-foreground">
                    {event.isFirst ? 'Unknown Host' : 'Host Key Changed'}
                  </h3>
                  <p
                    id="host-key-dialog-desc"
                    className="mt-1 text-xs text-muted-foreground leading-relaxed"
                  >
                    {event.isFirst
                      ? `The authenticity of host "${event.host}:${event.port}" can't be established. Do you want to trust this host?`
                      : `The host key for "${event.host}:${event.port}" has changed. This could indicate a man-in-the-middle attack.`}
                  </p>
                </div>
              </div>

              {/* Fingerprint details */}
              <div className="mt-4 space-y-2.5 rounded-lg border border-border/60 bg-background/50 p-3">
                <div className="flex items-center gap-2 text-xs">
                  <Fingerprint className="size-3.5 text-muted-foreground/60 flex-shrink-0" />
                  <span className="text-muted-foreground/70">Algorithm:</span>
                  <span className="font-mono text-foreground">{event.algorithm}</span>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <Fingerprint className="size-3.5 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-muted-foreground/70">
                      {event.isFirst
                        ? 'Server fingerprint:'
                        : 'New (server-presented) fingerprint:'}
                    </span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <code className="block break-all rounded bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-foreground/80 flex-1">
                        SHA256:{event.newFingerprint}
                      </code>
                      {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
                      <button
                        onClick={handleCopyFingerprint}
                        className="btn-icon flex-shrink-0 !p-1"
                        title="Copy fingerprint"
                      >
                        {copied ? (
                          <Check className="size-3 text-success" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {!event.isFirst && event.storedFingerprint && (
                  <div className="flex items-start gap-2 text-xs border-t border-border/60 pt-2.5">
                    <Fingerprint className="size-3.5 text-destructive/60 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <span className="text-muted-foreground/70">
                        Previously trusted fingerprint:
                      </span>
                      <code className="mt-1 block break-all rounded bg-destructive/5 px-1.5 py-0.5 font-mono text-xs text-destructive/80">
                        SHA256:{event.storedFingerprint}
                      </code>
                    </div>
                  </div>
                )}
              </div>

              {/* Warning for key change */}
              {!event.isFirst && (
                <div className="mt-3 rounded-lg bg-destructive/5 border border-destructive/20 p-2.5 text-[11px] text-destructive/90 leading-relaxed">
                  ⚠️ If you did not expect this change, someone could be eavesdropping on your
                  connection. Only trust the new key if you are sure the server was re-keyed.
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex justify-end gap-2">
                {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
                <button data-reject onClick={handleReject} className="btn-ghost">
                  Reject
                </button>
                {/** biome-ignore lint/a11y/useButtonType: suppressed during migration */}
                <button
                  onClick={handleTrust}
                  disabled={loading}
                  aria-busy={loading}
                  className={cn(
                    event.isFirst ? 'btn-primary' : 'btn-destructive',
                    loading && 'opacity-60 pointer-events-none',
                  )}
                >
                  {loading && <Spinner size="sm" />}
                  {event.isFirst ? 'Trust & Connect' : 'Trust New Key'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
