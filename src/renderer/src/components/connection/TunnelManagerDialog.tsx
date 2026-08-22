import type { ActivePortForwardInfo, PortForwardingConfig } from '@shared/types/connection';
import {
  ArrowRightLeft,
  Check,
  Copy,
  Network,
  Play,
  Plus,
  Power,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { EmptyState, Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

interface TunnelManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function TunnelManagerDialog({ open, onClose }: TunnelManagerDialogProps) {
  const [tunnels, setTunnels] = useState<ActivePortForwardInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSessions, setActiveSessions] = useState<{ id: string; connectionId: string }[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  // New tunnel form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<'local' | 'remote' | 'dynamic'>('local');
  const [newBindAddress, setNewBindAddress] = useState('127.0.0.1');
  const [newLocalPort, setNewLocalPort] = useState('8080');
  const [newRemoteHost, setNewRemoteHost] = useState('127.0.0.1');
  const [newRemotePort, setNewRemotePort] = useState('80');

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchActiveData = useCallback(async () => {
    try {
      const active = await getApi().app.getActiveSessions();
      setActiveSessions(active.ssh);
      if (active.ssh.length > 0 && !selectedSessionId) {
        setSelectedSessionId(active.ssh[0].id);
      }

      const activeTunnels = await getApi().ssh.listActivePortForwards();
      setTunnels(activeTunnels);
    } catch (err) {
      console.error('Failed to fetch active tunnels:', err);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchActiveData().finally(() => setLoading(false));

    const interval = setInterval(fetchActiveData, 2000);
    return () => clearInterval(interval);
  }, [open, fetchActiveData]);

  const handleStopTunnel = async (sessionId: string, forwardId: string) => {
    try {
      await getApi().ssh.stopPortForward({ sessionId, forwardId });
      toast.success('Port forward stopped');
      fetchActiveData();
    } catch (err) {
      toast.error(`Failed to stop port forward: ${(err as Error).message}`);
    }
  };

  const handleStartTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) {
      toast.error('No active SSH session selected');
      return;
    }

    const portNum = parseInt(newLocalPort, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      toast.error('Invalid local port');
      return;
    }

    const config: PortForwardingConfig = {
      id: `tunnel-${Date.now()}`,
      type: newType,
      bindAddress: newBindAddress || '127.0.0.1',
      localPort: portNum,
      remoteHost: newType !== 'dynamic' ? newRemoteHost || '127.0.0.1' : undefined,
      remotePort: newType !== 'dynamic' ? parseInt(newRemotePort, 10) || 80 : undefined,
    };

    try {
      await getApi().ssh.startPortForward({
        sessionId: selectedSessionId,
        config,
      });
      toast.success(`Started ${newType} port forward on port ${portNum}`);
      setShowAddForm(false);
      fetchActiveData();
    } catch (err) {
      toast.error(`Failed to start port forward: ${(err as Error).message}`);
    }
  };

  const copyProxyString = (t: ActivePortForwardInfo) => {
    const proxyStr =
      t.type === 'dynamic'
        ? `socks5://${t.bindAddress}:${t.localPort}`
        : `http://${t.bindAddress}:${t.localPort}`;
    navigator.clipboard.writeText(proxyStr);
    setCopiedId(t.id);
    toast.success(`Copied: ${proxyStr}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="tunnel-manager-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Network className="size-5" />
          </div>
          <div>
            <h2 id="tunnel-manager-dialog-title" className="text-base font-semibold">
              Active Port Forwards & Tunnels
            </h2>
            <p className="text-xs text-muted-foreground">
              Manage live SSH tunnels, SOCKS5 proxies, and local/remote port mappings
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
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            Active Tunnels ({tunnels.length})
          </div>

          {activeSessions.length > 0 && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              New Tunnel
            </button>
          )}
        </div>

        {/* Add New Tunnel Form */}
        {showAddForm && (
          <form
            onSubmit={handleStartTunnel}
            className="rounded-lg border border-border bg-accent/20 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-semibold">Add Dynamic / Local / Remote Tunnel</span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label
                  htmlFor="tunnel-target-ssh-session"
                  className="block text-muted-foreground mb-1"
                >
                  Target SSH Session
                </label>
                <select
                  id="tunnel-target-ssh-session"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  {activeSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      Session {s.id.slice(0, 8)} ({s.connectionId})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tunnel-tunnel-type" className="block text-muted-foreground mb-1">
                  Tunnel Type
                </label>
                <select
                  id="tunnel-tunnel-type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as 'local' | 'remote' | 'dynamic')}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="local">Local Forward (Local Port → Remote)</option>
                  <option value="remote">Remote Forward (Remote Port → Local)</option>
                  <option value="dynamic">Dynamic SOCKS5 Proxy</option>
                </select>
              </div>

              <div>
                <label htmlFor="tunnel-bind-address" className="block text-muted-foreground mb-1">
                  Bind Address
                </label>
                <input
                  id="tunnel-bind-address"
                  type="text"
                  value={newBindAddress}
                  onChange={(e) => setNewBindAddress(e.target.value)}
                  placeholder="127.0.0.1"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="tunnel-local-port" className="block text-muted-foreground mb-1">
                  Local Port
                </label>
                <input
                  id="tunnel-local-port"
                  type="number"
                  value={newLocalPort}
                  onChange={(e) => setNewLocalPort(e.target.value)}
                  placeholder="8080"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
              </div>

              {newType !== 'dynamic' && (
                <>
                  <div>
                    <label
                      htmlFor="tunnel-destination-host"
                      className="block text-muted-foreground mb-1"
                    >
                      Destination Host
                    </label>
                    <input
                      id="tunnel-destination-host"
                      type="text"
                      value={newRemoteHost}
                      onChange={(e) => setNewRemoteHost(e.target.value)}
                      placeholder="127.0.0.1"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="tunnel-destination-port"
                      className="block text-muted-foreground mb-1"
                    >
                      Destination Port
                    </label>
                    <input
                      id="tunnel-destination-port"
                      type="number"
                      value={newRemotePort}
                      onChange={(e) => setNewRemotePort(e.target.value)}
                      placeholder="80"
                      className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                <Play className="size-3.5" />
                Start Tunnel
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {loading && tunnels.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size="md" label="Loading active port forwards…" />
          </div>
        ) : tunnels.length === 0 ? (
          <EmptyState
            icon={<ArrowRightLeft />}
            title="No active port forwards"
            description="Active SSH tunnels will automatically appear here when connected to servers configured with port forwarding rules."
            className="rounded-xl border border-dashed border-border bg-accent/10 py-10"
          />
        ) : (
          <div className="space-y-2.5">
            {tunnels.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-background p-3.5 shadow-2xs hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-8 items-center justify-center rounded-md text-xs font-bold ${
                      t.status === 'active'
                        ? 'bg-success/10 text-success'
                        : 'bg-destructive/10 text-destructive-fg'
                    }`}
                  >
                    {t.type === 'dynamic' ? 'SOCKS' : t.type === 'local' ? 'LCL' : 'RMT'}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {t.bindAddress}:{t.localPort}
                      </span>
                      {t.type !== 'dynamic' && (
                        <>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {t.remoteHost || '127.0.0.1'}:{t.remotePort || 80}
                          </span>
                        </>
                      )}

                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          t.status === 'active'
                            ? 'bg-success/10 text-success'
                            : 'bg-destructive/10 text-destructive-fg'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1">
                      <span>Active Conns: {t.activeConnections ?? 0}</span>
                      <span>In: {formatBytes(t.bytesRead ?? 0)}</span>
                      <span>Out: {formatBytes(t.bytesWritten ?? 0)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyProxyString(t)}
                    title="Copy local proxy address"
                    className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                  >
                    {copiedId === t.id ? (
                      <Check className="size-3.5 text-success" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>

                  {t.sessionId && (
                    <button
                      onClick={() => handleStopTunnel(t.sessionId!, t.id)}
                      title="Stop tunnel"
                      className="rounded-md border border-destructive/20 bg-destructive/10 p-1.5 text-destructive-fg hover:bg-destructive/20 transition-colors cursor-pointer"
                    >
                      <Power className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 bg-muted/20 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="size-3.5 text-warning" />
          <span>Tunnels automatically close when the SSH session ends</span>
        </div>

        <button
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          Close
        </button>
      </div>
    </DialogShell>
  );
}
