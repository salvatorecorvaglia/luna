import { toastArgs } from '@shared/error-messages';
import type { SshHostKeyChangeEvent } from '@shared/types/terminal';
import { Check, Copy, Fingerprint, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { Spinner } from '@/components/ui';
import { useCopiedFlag } from '@/hooks/use-copied-flag';
import { connectToHost } from '@/lib/ssh';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

export function HostKeyDialog() {
  const [event, setEvent] = useState<SshHostKeyChangeEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const { copied, markCopied } = useCopiedFlag();

  useEffect(() => {
    const cleanup = getApi().ssh.onHostKeyChange((payload: SshHostKeyChangeEvent) => {
      setEvent(payload);
      setLoading(false);
      // The copied indicator is self-resetting (useCopiedFlag), so a new
      // host-key event no longer needs to clear it explicitly.
    });
    return cleanup;
  }, []);

  const handleTrust = useCallback(async () => {
    if (!event) return;
    setLoading(true);
    try {
      const result = await getApi().ssh.trustHostKey({
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
    markCopied();
  }, [event, markCopied]);

  return (
    <DialogShell
      open={event !== null}
      onClose={handleReject}
      zLayer={Z.hostKeyDialog}
      role="alertdialog"
      // Rejecting on outside-click is safe: it mirrors Escape (reject is
      // always the non-destructive option — the user just retries).
      dismissOnOverlayClick
      ariaLabelledBy="host-key-dialog-title"
      ariaDescribedBy="host-key-dialog-desc"
      panelClassName="w-full max-w-md rounded-xl border border-border/80 bg-card p-5 shadow-xl"
      onOpenFocus={(dialog) => dialog.querySelector<HTMLElement>('[data-reject]')?.focus()}
    >
      {/* Guarded (not just gated by `open` above) so the exiting instance
          that AnimatePresence keeps mounted during the close transition still
          has the last event's content to render — `open` and `children` both
          change on the same render when `event` clears. */}
      {event && (
        <>
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
                <ShieldAlert className="size-5 text-destructive-fg" />
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
                  {event.isFirst ? 'Server fingerprint:' : 'New (server-presented) fingerprint:'}
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <code className="block break-all rounded bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-foreground/80 flex-1">
                    SHA256:{event.newFingerprint}
                  </code>

                  <button
                    type="button"
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
                <Fingerprint className="size-3.5 text-destructive-fg/60 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="text-muted-foreground/70">Previously trusted fingerprint:</span>
                  <code className="mt-1 block break-all rounded bg-destructive/5 px-1.5 py-0.5 font-mono text-xs text-destructive-fg/80">
                    SHA256:{event.storedFingerprint}
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* Warning for key change */}
          {!event.isFirst && (
            <div className="mt-3 rounded-lg bg-destructive/5 border border-destructive/20 p-2.5 text-2xs text-destructive-fg/90 leading-relaxed">
              ⚠️ If you did not expect this change, someone could be eavesdropping on your
              connection. Only trust the new key if you are sure the server was re-keyed.
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" data-reject onClick={handleReject} className="btn-ghost">
              Reject
            </button>

            <button
              type="button"
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
        </>
      )}
    </DialogShell>
  );
}
