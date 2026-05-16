import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Cloud, FolderClosed, Loader2, Palette, Server, Wifi, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { attachFocusTrap } from '@/lib/focus-trap';
import { useConnectionStore } from '@/stores/connection-store';
import {
  useConnection,
  useConnections,
  useCreateConnection,
  useUpdateConnection,
} from '@/hooks/use-connections';
import type { AuthType } from '@shared/types/connection';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { COLOR_OPTIONS, dialogVariants, overlayVariants } from './connection-form.constants';
import { FormField } from './FormField';
import { SftpFields } from './SftpFields';
import { S3Fields } from './S3Fields';

export function ConnectionForm() {
  const { connectionFormOpen, editingConnectionId, duplicatingConnectionId, closeForm } =
    useConnectionStore();
  const { data: editingConnection } = useConnection(editingConnectionId);
  const { data: duplicatingConnection } = useConnection(duplicatingConnectionId);
  const { data: existingConnections, isLoading: connectionsLoading } = useConnections();
  const createMutation = useCreateConnection();
  const updateMutation = useUpdateConnection();

  const [provider, setProvider] = useState<StorageProviderKind>('sftp');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  // S3 fields
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [defaultBucket, setDefaultBucket] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [folder, setFolder] = useState('default');
  const [colorTag, setColorTag] = useState<string>(COLOR_OPTIONS[0].hex);
  const [isHidden, setIsHidden] = useState(false);
  /**
   * Empty string = "None (direct connection)". We deliberately don't use
   * `null/undefined` in form state so the controlled <select> never goes
   * uncontrolled when the user clears the field.
   */
  const [jumpHostConnectionId, setJumpHostConnectionId] = useState<string>('');
  const [jumpHostMode, setJumpHostMode] = useState<'existing' | 'manual'>('existing');
  const [jumpHostHost, setJumpHostHost] = useState('');
  const [jumpHostPort, setJumpHostPort] = useState('22');
  const [jumpHostUsername, setJumpHostUsername] = useState('');
  const [jumpHostAuthType, setJumpHostAuthType] = useState<AuthType>('password');
  const [jumpHostPassword, setJumpHostPassword] = useState('');
  const [jumpHostPrivateKeyPath, setJumpHostPrivateKeyPath] = useState('');
  const [jumpHostPassphrase, setJumpHostPassphrase] = useState('');
  const [showJumpHostPassword, setShowJumpHostPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /**
   * Inline result of the private-key file probe. Validated when the path
   * field blurs (and the path is non-empty) so the user sees "file not found"
   * inline instead of only learning at submit-time via a toast.
   */
  const [privateKeyProbeError, setPrivateKeyProbeError] = useState<string | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  // Holds the test-connection AbortController so the user can cancel a hung
  // test before the IPC reply (10 s+ for unreachable hosts).
  const testRunRef = useRef<{ controller: AbortController; runId: number } | null>(null);
  const testRunCounter = useRef(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const isEditing = !!editingConnectionId;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  // Tracks whether the user has typed anything since the form opened — gates
  // the "discard changes?" confirm dialog so a no-op close stays silent.
  const [dirty, setDirty] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  // Eligible jump-host targets: SFTP only, never the connection being edited,
  // never a connection that itself chains through another bastion (single-hop).
  const jumpHostOptions = useMemo(() => {
    if (!existingConnections) return [];
    return existingConnections.filter(
      (c) => c.provider === 'sftp' && c.id !== editingConnectionId && !c.jumpHostConnectionId,
    );
  }, [existingConnections, editingConnectionId]);

  const uniqueFolders = useMemo(() => {
    if (!existingConnections) return [];
    const folders = new Set(existingConnections.map((c) => c.folder).filter(Boolean));
    return Array.from(folders).sort();
  }, [existingConnections]);

  const filteredFolders = useMemo(() => {
    const search = folder === 'default' ? '' : folder.toLowerCase();
    return uniqueFolders.filter((f) => f.toLowerCase().includes(search));
  }, [uniqueFolders, folder]);

  // requestClose is hoisted via useCallback below; the focus trap reads it
  // through a ref so this effect doesn't have to rerun every time `dirty`
  // toggles (which would tear down + reattach the trap on every keystroke).
  const requestCloseRef = useRef<() => void>(() => closeForm());

  useEffect(() => {
    if (!connectionFormOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachFocusTrap(dialog, { onEscape: () => requestCloseRef.current() });
  }, [connectionFormOpen]);

  const resetForm = useCallback(() => {
    setProvider('sftp');
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setAuthType('password');
    setPassword('');
    setPrivateKeyPath('');
    setPassphrase('');
    setEndpoint('');
    setRegion('');
    setDefaultBucket('');
    setForcePathStyle(false);
    setAccessKeyId('');
    setSecretAccessKey('');
    setSessionToken('');
    setShowSecretKey(false);
    setFolder('default');
    setColorTag(COLOR_OPTIONS[0].hex);
    setShowPassword(false);
    setJumpHostConnectionId('');
    setJumpHostMode('existing');
    setJumpHostHost('');
    setJumpHostPort('22');
    setJumpHostUsername('');
    setJumpHostAuthType('password');
    setJumpHostPassword('');
    setJumpHostPrivateKeyPath('');
    setJumpHostPassphrase('');
    setShowJumpHostPassword(false);
    setIsHidden(false);
    setTouched({});
  }, []);

  // Sync form fields when the form opens or the source connection changes.
  // setState-in-effect is intentional: the source is a remote-loaded record.
  useEffect(() => {
    const source = editingConnection || duplicatingConnection;
    if (source) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setProvider(source.provider ?? 'sftp');
      setName(duplicatingConnection ? `${source.name} (copy)` : source.name);
      setHost(source.host);
      setPort(String(source.port));
      setUsername(source.username);
      setAuthType(source.authType);
      setPrivateKeyPath(source.privateKeyPath || '');
      setEndpoint(source.endpoint || '');
      setRegion(source.region || '');
      setDefaultBucket(source.defaultBucket || '');
      setForcePathStyle(source.forcePathStyle ?? false);
      setAccessKeyId('');
      setSecretAccessKey('');
      setSessionToken('');
      setFolder(source.folder);
      setColorTag(source.colorTag || COLOR_OPTIONS[0].hex);
      setIsHidden(source.isHidden ?? false);
      setJumpHostConnectionId(source.jumpHostConnectionId || '');
      if (source.jumpHostConfig) {
        setJumpHostMode('manual');
        setJumpHostHost(source.jumpHostConfig.host);
        setJumpHostPort(String(source.jumpHostConfig.port));
        setJumpHostUsername(source.jumpHostConfig.username);
        setJumpHostAuthType(source.jumpHostConfig.authType);
        setJumpHostPrivateKeyPath(source.jumpHostConfig.privateKeyPath || '');
      } else {
        setJumpHostMode('existing');
      }
      setPassword('');
      setPassphrase('');
      setJumpHostPassword('');
      setJumpHostPassphrase('');
      /* eslint-enable react-hooks/set-state-in-effect */
    } else {
      resetForm();
    }
    setTouched({});
    // Resetting dirty when the form is reseeded keeps the confirm dialog
    // from firing for changes that were programmatic (edit-mode prefill).
    setDirty(false);
  }, [editingConnection, duplicatingConnection, connectionFormOpen, resetForm]);

  // Defence-in-depth: whenever the form transitions to closed (cancel,
  // escape, X button, discard, *or* submit), wipe transient secrets from
  // React state. Submit also clears them inline before closeForm() so the
  // window is short, but this effect catches every other close path so a
  // cleartext password can't linger across the close animation.
  useEffect(() => {
    if (connectionFormOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPassword('');
    setPassphrase('');
    setSecretAccessKey('');
    setSessionToken('');
    setAccessKeyId('');
    setJumpHostPassword('');
    setJumpHostPassphrase('');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [connectionFormOpen]);

  // Guarded close: prompt to confirm discard if the user has typed anything.
  const requestClose = useCallback(() => {
    if (dirty && !isSaving) {
      setConfirmDiscardOpen(true);
    } else {
      closeForm();
    }
  }, [dirty, isSaving, closeForm]);
  // Keep the ref in sync so the focus trap's onEscape always runs the
  // current closure (with the latest `dirty` snapshot) without forcing
  // attachFocusTrap to be torn down and rebuilt on every change.
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // Name uniqueness has to be live (it's a duplicate-detection signal as the
  // user types), but the rest is cheap to validate on demand and shouldn't
  // re-walk N existingConnections per keystroke.
  const nameError = useMemo<string | undefined>(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return 'Connection name is required';
    const lower = trimmedName.toLowerCase();
    const collides = existingConnections?.some(
      (c) => c.name.trim().toLowerCase() === lower && c.id !== editingConnectionId,
    );
    return collides ? 'A connection with this name already exists' : undefined;
  }, [name, existingConnections, editingConnectionId]);

  // Per-field validation (no list walks) — recomputed on the cheap inputs.
  const fieldErrors = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (provider === 'sftp') {
      if (!host.trim()) out.host = 'Host is required';
      const portNum = parseInt(port, 10);
      if (port.trim() === '' || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        out.port = 'Port must be between 1 and 65535';
      }
      if (!username.trim()) out.username = 'Username is required';
      if (authType === 'password' && !isEditing && !password.trim()) {
        out.password = 'Password is required';
      }
      if ((authType === 'key' || authType === 'key+passphrase') && !privateKeyPath.trim()) {
        out.privateKeyPath = 'Private key path is required';
      } else if (privateKeyProbeError) {
        out.privateKeyPath = privateKeyProbeError;
      }

      if (jumpHostMode === 'manual') {
        if (!jumpHostHost.trim()) out.jumpHostHost = 'Jump host is required';
        const jhPortNum = parseInt(jumpHostPort, 10);
        if (
          jumpHostPort.trim() === '' ||
          Number.isNaN(jhPortNum) ||
          jhPortNum < 1 ||
          jhPortNum > 65535
        ) {
          out.jumpHostPort = 'Port must be between 1 and 65535';
        }
        if (!jumpHostUsername.trim()) out.jumpHostUsername = 'Username is required';
        if (
          (jumpHostAuthType === 'key' || jumpHostAuthType === 'key+passphrase') &&
          !jumpHostPrivateKeyPath.trim()
        ) {
          out.jumpHostPrivateKeyPath = 'Private key path is required';
        }
      }
    } else {
      // S3 — credentials only required on create. On edit, leaving them
      // blank means "keep existing" (mirrors the SSH password UX).
      if (!isEditing && !accessKeyId.trim()) out.accessKeyId = 'Access Key ID is required';
      if (!isEditing && !secretAccessKey.trim()) {
        out.secretAccessKey = 'Secret Access Key is required';
      }
    }
    return out;
  }, [
    provider,
    host,
    port,
    username,
    authType,
    privateKeyPath,
    privateKeyProbeError,
    accessKeyId,
    secretAccessKey,
    isEditing,
    jumpHostMode,
    jumpHostHost,
    jumpHostPort,
    jumpHostUsername,
    jumpHostAuthType,
    jumpHostPrivateKeyPath,
    password,
  ]);

  // Debounced inline probe of the private-key file. All setState calls happen
  // inside the deferred timeout callback (asynchronous), so the effect itself
  // never commits state synchronously — the clear-on-empty path is also
  // queued through the same timer to keep that property.
  useEffect(() => {
    const needsKey = provider === 'sftp' && (authType === 'key' || authType === 'key+passphrase');
    const path = privateKeyPath.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      if (!needsKey || !path) {
        setPrivateKeyProbeError(undefined);
        return;
      }
      try {
        const probe = await window.api.shell.checkFile(path);
        if (cancelled) return;
        setPrivateKeyProbeError(
          probe.ok
            ? undefined
            : probe.reason === 'missing'
              ? 'Private key file not found'
              : probe.reason === 'permission'
                ? 'Cannot read private key (permission denied)'
                : probe.reason === 'not-a-file'
                  ? 'Private key path is not a file'
                  : 'Could not access private key file',
        );
      } catch {
        if (!cancelled) setPrivateKeyProbeError(undefined);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [provider, authType, privateKeyPath]);

  const errors = useMemo<Record<string, string>>(
    () => (nameError ? { ...fieldErrors, name: nameError } : fieldErrors),
    [fieldErrors, nameError],
  );

  const visibleError = (field: string): string | undefined =>
    touched[field] ? errors[field] : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      name: true,
      host: true,
      port: true,
      username: true,
      password: true,
      privateKeyPath: true,
      passphrase: true,
      accessKeyId: true,
      secretAccessKey: true,
    });

    if (Object.keys(errors).length > 0) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    if (
      provider === 'sftp' &&
      (authType === 'key' || authType === 'key+passphrase') &&
      privateKeyPath.trim().length > 0
    ) {
      const probe = await window.api.shell.checkFile(privateKeyPath.trim());
      if (!probe.ok) {
        const reason =
          probe.reason === 'missing'
            ? 'Private key file not found'
            : probe.reason === 'permission'
              ? 'Cannot read private key (permission denied)'
              : probe.reason === 'not-a-file'
                ? 'Private key path is not a file'
                : 'Could not access private key file';
        toast.error(reason);
        return;
      }
    }

    const data =
      provider === 'sftp'
        ? {
            name: name.trim(),
            provider: 'sftp' as const,
            host: host.trim(),
            port: parseInt(port) || 22,
            username: username.trim(),
            authType,
            privateKeyPath: privateKeyPath || undefined,
            password: password || undefined,
            passphrase: passphrase || undefined,
            // Send explicit null on edit so an unselect actually clears the
            // FK. New connections only carry the value when set.
            jumpHostConnectionId: jumpHostConnectionId
              ? jumpHostConnectionId
              : isEditing
                ? null
                : undefined,
            folder: folder.trim() || 'default',
            colorTag,
            isHidden,
          }
        : {
            name: name.trim(),
            provider: 's3' as const,
            endpoint: endpoint.trim() || undefined,
            region: region.trim() || undefined,
            defaultBucket: defaultBucket.trim() || undefined,
            forcePathStyle,
            accessKeyId: accessKeyId.trim() || undefined,
            secretAccessKey: secretAccessKey || undefined,
            sessionToken: sessionToken || undefined,
            folder: folder.trim() || 'default',
            colorTag,
            isHidden,
            jumpHostConfig:
              jumpHostMode === 'manual'
                ? {
                    host: jumpHostHost.trim(),
                    port: parseInt(jumpHostPort) || 22,
                    username: jumpHostUsername.trim(),
                    authType: jumpHostAuthType,
                    privateKeyPath: jumpHostPrivateKeyPath || undefined,
                    password: jumpHostPassword || undefined,
                    passphrase: jumpHostPassphrase || undefined,
                  }
                : isEditing && !jumpHostConnectionId
                  ? null
                  : undefined,
          };

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: editingConnectionId!, ...data });
        toast.success('Connection updated');
      } else {
        await createMutation.mutateAsync(data);
        toast.success('Connection created');
      }
      // Wipe transient secrets from React state immediately rather than
      // relying on unmount: between submit and unmount the dialog can
      // animate out for a few hundred ms, during which heap snapshots /
      // devtools would still expose the cleartext.
      setPassword('');
      setPassphrase('');
      setSecretAccessKey('');
      setSessionToken('');
      setAccessKeyId('');
      setJumpHostPassword('');
      setJumpHostPassphrase('');
      closeForm();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save connection');
    }
  }

  function cancelTest(): void {
    const run = testRunRef.current;
    if (!run) return;
    run.controller.abort();
    testRunRef.current = null;
    setTesting(false);
    toast.info('Connection test cancelled');
  }

  /**
   * Hard ceiling on a single test run. The main-side handler already times
   * out the SSH connect at LIMITS.SSH_CONNECT_TIMEOUT_MS (60s), but if the
   * IPC itself stalls (main crash, paused renderer-host link) the button
   * would otherwise stay stuck on "Testing…" forever. 65s gives the server
   * a clean grace window without leaving the user waiting indefinitely.
   */
  const TEST_HARD_TIMEOUT_MS = 65_000;

  async function handleTest() {
    // If a test is already running, treat the click as a cancel.
    if (testRunRef.current) {
      cancelTest();
      return;
    }

    const runId = ++testRunCounter.current;
    const controller = new AbortController();
    testRunRef.current = { controller, runId };
    const watchdog = setTimeout(() => {
      // Only fire if this run is still the active one — a fast user-cancel
      // would have already cleared the ref.
      if (testRunRef.current?.runId !== runId) return;
      controller.abort();
      testRunRef.current = null;
      setTesting(false);
      toast.error('Connection test timed out — main process not responding');
    }, TEST_HARD_TIMEOUT_MS);
    // The controller's onabort fires from cancelTest() too; clean the timer
    // there so a manual cancel doesn't leave it ticking against a stale runId.
    controller.signal.addEventListener('abort', () => clearTimeout(watchdog), { once: true });

    /** Apply a result only if no newer test has superseded this one and
     *  the user hasn't aborted in the meantime. Prevents stale toasts when
     *  the user starts a second test before the first replies. */
    const isStillCurrent = (): boolean =>
      testRunRef.current?.runId === runId && !controller.signal.aborted;

    if (provider === 'sftp') {
      if (!host.trim() || !username.trim()) {
        toast.error('Host and Username are required to test');
        testRunRef.current = null;
        return;
      }
      setTesting(true);
      try {
        const result = await window.api.ssh.testConnection({
          config: {
            host: host.trim(),
            port: parseInt(port) || 22,
            username: username.trim(),
            authType,
            privateKeyPath: privateKeyPath || undefined,
            password: password || undefined,
            passphrase: passphrase || undefined,
            jumpHostConnectionId:
              jumpHostMode === 'existing' ? jumpHostConnectionId || undefined : undefined,
            jumpHostConfig:
              jumpHostMode === 'manual'
                ? {
                    host: jumpHostHost.trim(),
                    port: parseInt(jumpHostPort) || 22,
                    username: jumpHostUsername.trim(),
                    authType: jumpHostAuthType,
                    privateKeyPath: jumpHostPrivateKeyPath || undefined,
                    password: jumpHostPassword || undefined,
                    passphrase: jumpHostPassphrase || undefined,
                  }
                : undefined,
          },
        });
        if (!isStillCurrent()) return;
        if (result.ok) {
          toast.success('Connection successful');
        } else {
          toast.error(result.error || 'Connection failed');
        }
      } finally {
        clearTimeout(watchdog);
        if (testRunRef.current?.runId === runId) {
          testRunRef.current = null;
          setTesting(false);
        }
      }
    } else {
      const useStored = isEditing && !accessKeyId.trim() && !secretAccessKey.trim();
      if (!useStored && (!accessKeyId.trim() || !secretAccessKey.trim())) {
        toast.error('Access Key ID and Secret Access Key are required to test');
        testRunRef.current = null;
        return;
      }
      setTesting(true);
      try {
        const result = await window.api.s3.testConnection(
          useStored
            ? { connectionId: editingConnectionId || undefined }
            : {
                config: {
                  endpoint: endpoint.trim() || undefined,
                  region: region.trim() || undefined,
                  forcePathStyle,
                  accessKeyId: accessKeyId.trim(),
                  secretAccessKey,
                  sessionToken: sessionToken || undefined,
                  defaultBucket: defaultBucket.trim() || undefined,
                },
              },
        );
        if (!isStillCurrent()) return;
        if (result.ok) {
          toast.success('S3 connection successful');
        } else {
          toast.error(result.error || 'S3 connection failed');
        }
      } finally {
        clearTimeout(watchdog);
        if (testRunRef.current?.runId === runId) {
          testRunRef.current = null;
          setTesting(false);
        }
      }
    }
  }

  async function handleBrowseKey() {
    const path = await window.api.shell.openFileDialog({
      filters: [
        { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk', 'pub', 'p8', 'p8e', 'ssh2', ''] },
      ],
    });
    if (path) {
      setPrivateKeyPath(path);
    }
  }

  return (
    <AnimatePresence>
      {connectionFormOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Dialog */}
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="no-drag fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="connection-form-title"
              className="no-drag flex flex-col w-full max-w-lg max-h-[85vh] rounded-xl border border-border/80 bg-card shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <Server className="h-4 w-4 text-primary" />
                  </div>
                  <h2
                    id="connection-form-title"
                    className="text-base font-semibold text-foreground"
                  >
                    {isEditing
                      ? 'Edit Connection'
                      : duplicatingConnection
                        ? 'Duplicate Connection'
                        : 'New Connection'}
                  </h2>
                </div>
                <button onClick={requestClose} className="btn-icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form — onChange bubbles from every input so we mark dirty
                  once without sprinkling onChange wrappers across each field. */}
              <form
                onSubmit={handleSubmit}
                onChange={markDirty}
                onInput={markDirty}
                className="flex flex-col min-h-0 flex-1"
              >
                {/* Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                  {/* Provider toggle */}
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Cloud className="h-3.5 w-3.5" />
                      Provider
                    </label>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Provider">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={provider === 'sftp'}
                        onClick={() => setProvider('sftp')}
                        disabled={isEditing}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                          provider === 'sftp'
                            ? 'border-ring bg-accent text-foreground shadow-xs'
                            : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50',
                        )}
                      >
                        <Server className="h-4 w-4" />
                        SSH / SFTP
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={provider === 's3'}
                        onClick={() => setProvider('s3')}
                        disabled={isEditing}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                          provider === 's3'
                            ? 'border-ring bg-accent text-foreground shadow-xs'
                            : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50',
                        )}
                      >
                        <Cloud className="h-4 w-4" />
                        S3-compatible
                      </button>
                    </div>
                  </div>

                  {/* Name */}
                  <FormField
                    label="Connection Name"
                    icon={<Server className="h-3.5 w-3.5" aria-hidden="true" />}
                    required
                    id={`${fieldId}-name`}
                    error={visibleError('name')}
                  >
                    <input
                      id={`${fieldId}-name`}
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => markTouched('name')}
                      placeholder="My Server"
                      aria-invalid={!!visibleError('name')}
                      aria-describedby={visibleError('name') ? `${fieldId}-name-error` : undefined}
                      className={cn(
                        'form-input',
                        visibleError('name') && 'border-destructive/60 focus:border-destructive',
                      )}
                    />
                  </FormField>

                  {provider === 'sftp' && (
                    <SftpFields
                      fieldId={fieldId}
                      isEditing={isEditing}
                      host={host}
                      setHost={setHost}
                      port={port}
                      setPort={setPort}
                      username={username}
                      setUsername={setUsername}
                      authType={authType}
                      setAuthType={setAuthType}
                      password={password}
                      setPassword={setPassword}
                      privateKeyPath={privateKeyPath}
                      setPrivateKeyPath={setPrivateKeyPath}
                      passphrase={passphrase}
                      setPassphrase={setPassphrase}
                      showPassword={showPassword}
                      setShowPassword={setShowPassword}
                      jumpHostOptions={jumpHostOptions}
                      jumpHostConnectionId={jumpHostConnectionId}
                      setJumpHostConnectionId={setJumpHostConnectionId}
                      jumpHostMode={jumpHostMode}
                      setJumpHostMode={setJumpHostMode}
                      jumpHostHost={jumpHostHost}
                      setJumpHostHost={setJumpHostHost}
                      jumpHostPort={jumpHostPort}
                      setJumpHostPort={setJumpHostPort}
                      jumpHostUsername={jumpHostUsername}
                      setJumpHostUsername={setJumpHostUsername}
                      jumpHostAuthType={jumpHostAuthType}
                      setJumpHostAuthType={setJumpHostAuthType}
                      jumpHostPassword={jumpHostPassword}
                      setJumpHostPassword={setJumpHostPassword}
                      jumpHostPrivateKeyPath={jumpHostPrivateKeyPath}
                      setJumpHostPrivateKeyPath={setJumpHostPrivateKeyPath}
                      jumpHostPassphrase={jumpHostPassphrase}
                      setJumpHostPassphrase={setJumpHostPassphrase}
                      showJumpHostPassword={showJumpHostPassword}
                      setShowJumpHostPassword={setShowJumpHostPassword}
                      visibleError={visibleError}
                      markTouched={markTouched}
                      onBrowseKey={handleBrowseKey}
                    />
                  )}

                  {provider === 's3' && (
                    <S3Fields
                      fieldId={fieldId}
                      isEditing={isEditing}
                      endpoint={endpoint}
                      setEndpoint={setEndpoint}
                      region={region}
                      setRegion={setRegion}
                      defaultBucket={defaultBucket}
                      setDefaultBucket={setDefaultBucket}
                      forcePathStyle={forcePathStyle}
                      setForcePathStyle={setForcePathStyle}
                      accessKeyId={accessKeyId}
                      setAccessKeyId={setAccessKeyId}
                      secretAccessKey={secretAccessKey}
                      setSecretAccessKey={setSecretAccessKey}
                      sessionToken={sessionToken}
                      setSessionToken={setSessionToken}
                      showSecretKey={showSecretKey}
                      setShowSecretKey={setShowSecretKey}
                      visibleError={visibleError}
                      markTouched={markTouched}
                    />
                  )}

                  {/* Color Tag */}
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Palette className="h-3.5 w-3.5" />
                      Color Tag
                    </label>
                    <div className="flex gap-2.5" role="radiogroup" aria-label="Color tag">
                      {COLOR_OPTIONS.map((color) => (
                        <button
                          key={color.hex}
                          type="button"
                          role="radio"
                          aria-checked={colorTag === color.hex}
                          aria-label={color.name}
                          onClick={() => setColorTag(color.hex)}
                          className={cn(
                            'relative h-7 w-7 rounded-full cursor-pointer',
                            colorTag === color.hex
                              ? 'ring-2 ring-ring ring-offset-2 ring-offset-card'
                              : 'hover:scale-110',
                          )}
                          style={{ backgroundColor: color.hex }}
                        >
                          {colorTag === color.hex && (
                            <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow-sm" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Folder / Group */}
                  <FormField
                    label="Group"
                    icon={<FolderClosed className="h-3.5 w-3.5" />}
                    optional
                    id={`${fieldId}-group`}
                  >
                    <div className="space-y-3">
                      <div className="relative group/input">
                        <input
                          id={`${fieldId}-group`}
                          type="text"
                          value={folder === 'default' ? '' : folder}
                          onChange={(e) => {
                            setFolder(e.target.value || 'default');
                            setShowGroupsDropdown(true);
                          }}
                          onFocus={() => setShowGroupsDropdown(true)}
                          onBlur={() => {
                            // Small delay to allow click on dropdown items
                            setTimeout(() => setShowGroupsDropdown(false), 200);
                          }}
                          placeholder="default"
                          className="form-input"
                          style={{ paddingLeft: '2.5rem' }}
                        />
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within/input:text-primary transition-colors pointer-events-none">
                          <FolderClosed className="h-4 w-4" />
                        </div>

                        {folder !== 'default' && (
                          <button
                            type="button"
                            onClick={() => setFolder('default')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
                            title="Clear group"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <AnimatePresence>
                          {showGroupsDropdown && filteredFolders.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.98 }}
                              className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl backdrop-blur-sm scrollbar-none"
                            >
                              {filteredFolders.map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  onClick={() => {
                                    setFolder(f);
                                    setShowGroupsDropdown(false);
                                  }}
                                  className={cn(
                                    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer',
                                    folder === f
                                      ? 'bg-primary/10 text-primary'
                                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                                  )}
                                >
                                  <FolderClosed className="h-3.5 w-3.5 opacity-50" />
                                  {f}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {uniqueFolders.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest">
                              Existing Groups
                            </span>
                            <div className="h-px flex-1 bg-border/30" />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {uniqueFolders.map((f) => (
                              <motion.button
                                key={f}
                                whileHover={{ y: -1, scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                type="button"
                                onClick={() => setFolder(folder === f ? 'default' : f)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border shadow-xs',
                                  folder === f || (f === 'default' && folder === 'default')
                                    ? 'bg-primary/5 border-primary/40 text-primary shadow-[0_0_12px_-3px_rgba(99,102,241,0.2)] ring-1 ring-primary/20'
                                    : 'bg-muted/10 border-border/40 text-muted-foreground hover:bg-muted/20 hover:border-border/60 hover:text-foreground',
                                )}
                              >
                                <FolderClosed
                                  className={cn(
                                    'h-3 w-3 transition-opacity',
                                    folder === f || (f === 'default' && folder === 'default')
                                      ? 'opacity-100'
                                      : 'opacity-40',
                                  )}
                                />
                                {f}
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </FormField>
                </div>

                {/* Fixed Footer */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-muted/5 px-5 py-4">
                  <button
                    type="button"
                    onClick={handleTest}
                    aria-busy={testing}
                    title={testing ? 'Click to cancel the running test' : undefined}
                    className={cn(
                      'btn-outline',
                      testing &&
                        'bg-primary/5 border-primary/30 text-primary shadow-sm ring-1 ring-primary/20',
                    )}
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Wifi className="h-3.5 w-3.5" />
                    )}
                    <span className={cn(testing && 'font-semibold')}>
                      {testing ? 'Testing…' : 'Test connection'}
                    </span>
                  </button>

                  <div className="flex gap-2">
                    <button type="button" onClick={requestClose} className="btn-ghost">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving || connectionsLoading}
                      aria-busy={isSaving || connectionsLoading}
                      className="btn-primary"
                    >
                      {(isSaving || connectionsLoading) && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                      )}
                      {isSaving
                        ? 'Saving...'
                        : connectionsLoading
                          ? 'Loading…'
                          : isEditing
                            ? 'Update Connection'
                            : 'Create Connection'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
          <ConfirmDialog
            open={confirmDiscardOpen}
            title="Discard changes?"
            message="You have unsaved changes to this connection. Closing now will discard them."
            confirmLabel="Discard"
            destructive
            onConfirm={() => {
              setConfirmDiscardOpen(false);
              closeForm();
            }}
            onCancel={() => setConfirmDiscardOpen(false)}
          />
        </>
      )}
    </AnimatePresence>
  );
}
