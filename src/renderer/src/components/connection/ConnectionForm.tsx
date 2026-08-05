import { toastArgs } from '@shared/error-messages';
import type { StorageProviderKind } from '@shared/types/storage-provider';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Cloud,
  FolderClosed,
  Palette,
  Server,
  Wifi,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/ui';
import {
  useConnection,
  useConnections,
  useCreateConnection,
  useUpdateConnection,
} from '@/hooks/use-connections';
import { attachFocusTrap } from '@/lib/focus-trap';
import { cn } from '@/lib/utils';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';
import { useConnectionStore } from '@/stores/connection-store';
import { COLOR_OPTIONS, dialogVariants, overlayVariants } from './connection-form.constants';
import { FormField } from './FormField';
import { S3Fields } from './S3Fields';
import { SftpFields } from './SftpFields';
import { useConnectionFormState } from './use-connection-form-state';
import { useConnectionTest } from './use-connection-test';

export function ConnectionForm() {
  const { connectionFormOpen, editingConnectionId, duplicatingConnectionId, closeForm } =
    useConnectionStore();
  const { data: editingConnection } = useConnection(editingConnectionId);
  const { data: duplicatingConnection } = useConnection(duplicatingConnectionId);
  const { data: existingConnections, isLoading: connectionsLoading } = useConnections();
  const createMutation = useCreateConnection();
  const updateMutation = useUpdateConnection();

  const {
    common,
    sftp,
    s3,
    patchCommon,
    patchSftp,
    patchS3,
    touched,
    markTouched,
    setTouched,
    dirty,
    markDirty,
    setDirty,
    resetForm,
    reseedFromConnection,
    clearSecrets,
  } = useConnectionFormState(COLOR_OPTIONS[0].hex);

  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);
  /**
   * Inline result of the private-key file probe. Validated when the path
   * field blurs (and the path is non-empty) so the user sees "file not found"
   * inline instead of only learning at submit-time via a toast.
   */
  const [privateKeyProbeError, setPrivateKeyProbeError] = useState<string | undefined>(undefined);
  // Test-connection lifecycle (run id, abort, watchdog) lives in its own hook —
  // it is separate machinery from the form's field state.
  const {
    testing,
    result: testResult,
    clearResult: clearTestResult,
    runTest,
  } = useConnectionTest();

  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const isEditing = !!editingConnectionId;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const uniqueFolders = useMemo(() => {
    if (!existingConnections) return [];
    const folders = new Set(existingConnections.map((c) => c.folder).filter(Boolean));
    return Array.from(folders).sort();
  }, [existingConnections]);

  const filteredFolders = useMemo(() => {
    const search = common.folder === 'default' ? '' : common.folder.toLowerCase();
    return uniqueFolders.filter((f) => f.toLowerCase().includes(search));
  }, [uniqueFolders, common.folder]);

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

  // Sync form fields when the form opens or the source connection changes.
  // setState-in-effect is intentional: the source is a remote-loaded record.

  useEffect(() => {
    const source = editingConnection || duplicatingConnection;
    if (source) {
      reseedFromConnection(source, { isDuplicate: !!duplicatingConnection });
    } else {
      resetForm();
    }
    setTouched({});
    // Resetting dirty when the form is reseeded keeps the confirm dialog
    // from firing for changes that were programmatic (edit-mode prefill).
    setDirty(false);
  }, [
    editingConnection,
    duplicatingConnection,
    connectionFormOpen,
    reseedFromConnection,
    resetForm,
    setTouched,
    setDirty,
  ]);

  // Defence-in-depth: whenever the form transitions to closed (cancel,
  // escape, X button, discard, *or* submit), wipe transient secrets from
  // React state. Submit also clears them inline before closeForm() so the
  // window is short, but this effect catches every other close path so a
  // cleartext password can't linger across the close animation.
  useEffect(() => {
    if (connectionFormOpen) return;
    clearSecrets();
  }, [connectionFormOpen, clearSecrets]);

  // Drop the inline test outcome whenever the form re-opens. Using the
  // render-time prevState pattern (vs. setState-in-effect) keeps the update
  // in the same commit as the open transition — no extra paint, no lint
  // warning. A stale "Connection successful" tied to the previous host
  // would otherwise mislead the user when they edit a different connection.
  const [prevFormOpen, setPrevFormOpen] = useState(connectionFormOpen);
  if (prevFormOpen !== connectionFormOpen) {
    setPrevFormOpen(connectionFormOpen);
    if (!connectionFormOpen) clearTestResult();
  }

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

  // Precompute a lowercase-name Set keyed on the connection list so the
  // per-keystroke collision check is O(1) instead of an O(n) walk with a
  // per-item trim+toLowerCase. The Set rebuilds only when the list changes
  // or the user opens a different connection to edit.
  const existingNamesLower = useMemo(() => {
    const out = new Set<string>();
    for (const c of existingConnections ?? []) {
      if (c.id === editingConnectionId) continue;
      out.add(c.name.trim().toLowerCase());
    }
    return out;
  }, [existingConnections, editingConnectionId]);

  // Name uniqueness has to be live (it's a duplicate-detection signal as the
  // user types), but the rest is cheap to validate on demand and shouldn't
  // re-walk N existingConnections per keystroke.
  const nameError = useMemo<string | undefined>(() => {
    const trimmedName = common.name.trim();
    if (!trimmedName) return 'Connection name is required';
    return existingNamesLower.has(trimmedName.toLowerCase())
      ? 'A connection with this name already exists'
      : undefined;
  }, [common.name, existingNamesLower]);

  // Per-field validation (no list walks) — recomputed on the cheap inputs.
  const fieldErrors = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (common.provider === 'sftp') {
      if (!sftp.host.trim()) out.host = 'Host is required';
      const portNum = parseInt(sftp.port, 10);
      if (sftp.port.trim() === '' || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        out.port = 'Port must be between 1 and 65535';
      }
      if (!sftp.username.trim()) out.username = 'Username is required';
      if (sftp.authType === 'password' && !isEditing && !sftp.password.trim()) {
        out.password = 'Password is required';
      }
      if (
        (sftp.authType === 'key' || sftp.authType === 'key+passphrase') &&
        !sftp.privateKeyPath.trim()
      ) {
        out.privateKeyPath = 'Private key path is required';
      } else if (privateKeyProbeError) {
        out.privateKeyPath = privateKeyProbeError;
      }
    } else {
      // S3 — credentials only required on create. On edit, leaving them
      // blank means "keep existing" (mirrors the SSH password UX).
      if (s3.port.trim() !== '') {
        const portNum = parseInt(s3.port, 10);
        if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
          out.port = 'Port must be between 1 and 65535';
        }
      }
      if (!isEditing && !s3.accessKeyId.trim()) out.accessKeyId = 'Access Key ID is required';
      if (!isEditing && !s3.secretAccessKey.trim()) {
        out.secretAccessKey = 'Secret Access Key is required';
      }
    }
    return out;
  }, [common.provider, sftp, s3, isEditing, privateKeyProbeError]);

  // Debounced inline probe of the private-key file. All setState calls happen
  // inside the deferred timeout callback (asynchronous), so the effect itself
  // never commits state synchronously — the clear-on-empty path is also
  // queued through the same timer to keep that property.
  useEffect(() => {
    const needsKey =
      common.provider === 'sftp' && (sftp.authType === 'key' || sftp.authType === 'key+passphrase');
    const path = sftp.privateKeyPath.trim();
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      if (!needsKey || !path) {
        setPrivateKeyProbeError(undefined);
        return;
      }
      try {
        const probe = await getApi().shell.checkFile(path);
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
  }, [common.provider, sftp.authType, sftp.privateKeyPath]);

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
      common.provider === 'sftp' &&
      (sftp.authType === 'key' || sftp.authType === 'key+passphrase') &&
      sftp.privateKeyPath.trim().length > 0
    ) {
      const probe = await getApi().shell.checkFile(sftp.privateKeyPath.trim());
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
      common.provider === 'sftp'
        ? {
            name: common.name.trim(),
            provider: 'sftp' as const,
            host: sftp.host.trim(),

            port: parseInt(sftp.port) || 22,
            username: sftp.username.trim(),
            authType: sftp.authType,
            privateKeyPath: sftp.privateKeyPath || undefined,
            password: sftp.password || undefined,
            passphrase: sftp.passphrase || undefined,
            keepaliveInterval: (parseInt(sftp.keepaliveInterval) || 10) * 1000,
            keepaliveCountMax: parseInt(sftp.keepaliveCountMax) || 3,
            portForwards: sftp.portForwards,
            folder: common.folder.trim() || 'default',
            colorTag: common.colorTag,
            isHidden: common.isHidden,
          }
        : {
            name: common.name.trim(),
            provider: 's3' as const,
            endpoint: s3.host.trim()
              ? `${s3.protocol}://${s3.host.trim()}${s3.port.trim() ? `:${s3.port.trim()}` : ''}`
              : undefined,
            region: s3.region.trim() || undefined,
            defaultBucket: s3.defaultBucket.trim() || undefined,
            forcePathStyle: s3.forcePathStyle,
            accessKeyId: s3.accessKeyId.trim() || undefined,
            secretAccessKey: s3.secretAccessKey || undefined,
            sessionToken: s3.sessionToken || undefined,
            folder: common.folder.trim() || 'default',
            colorTag: common.colorTag,
            isHidden: common.isHidden,
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
      clearSecrets();
      closeForm();
    } catch (err: unknown) {
      toast.error(...toastArgs(err, 'Failed to save connection'));
    }
  }

  function handleTest(): void {
    void runTest({
      provider: common.provider,
      sftp,
      s3,
      editingConnectionId,
      isEditing,
    });
  }

  async function handleBrowseKey() {
    const path = await getApi().shell.openFileDialog({
      filters: [
        { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk', 'pub', 'p8', 'p8e', 'ssh2', ''] },
      ],
    });
    if (path) {
      patchSftp({ privateKeyPath: path });
    }
  }

  const setProvider = (p: StorageProviderKind): void => patchCommon({ provider: p });
  const setName = (v: string): void => patchCommon({ name: v });
  const setFolder = (v: string): void => patchCommon({ folder: v });
  const setColorTag = (v: string): void => patchCommon({ colorTag: v });

  return (
    <AnimatePresence>
      {connectionFormOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="overlay"
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`fixed inset-0 ${Z.modal} bg-black/60 backdrop-blur-sm`}
          />

          {/* Dialog */}
          <motion.div
            key="panel"
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`no-drag fixed inset-0 ${Z.modal} flex items-center justify-center p-4`}
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
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                    <Server className="size-4 text-primary" />
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
                  <X className="size-4" />
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
                      <Cloud className="size-3.5" />
                      Provider
                    </label>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Provider">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={common.provider === 'sftp'}
                        onClick={() => setProvider('sftp')}
                        disabled={isEditing}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                          common.provider === 'sftp'
                            ? 'border-ring bg-accent text-foreground shadow-xs'
                            : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50',
                        )}
                      >
                        <Server className="size-4" />
                        SSH / SFTP
                      </button>

                      <button
                        type="button"
                        role="radio"
                        aria-checked={common.provider === 's3'}
                        onClick={() => setProvider('s3')}
                        disabled={isEditing}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                          common.provider === 's3'
                            ? 'border-ring bg-accent text-foreground shadow-xs'
                            : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50',
                        )}
                      >
                        <Cloud className="size-4" />
                        S3-compatible
                      </button>
                    </div>
                  </div>

                  {/* Name */}
                  <FormField
                    label="Connection Name"
                    icon={<Server className="size-3.5" aria-hidden="true" />}
                    required
                    id={`${fieldId}-name`}
                    error={visibleError('name')}
                  >
                    <input
                      id={`${fieldId}-name`}
                      type="text"
                      value={common.name}
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

                  {common.provider === 'sftp' && (
                    <SftpFields
                      fieldId={fieldId}
                      isEditing={isEditing}
                      sftp={sftp}
                      onSftpChange={patchSftp}
                      visibleError={visibleError}
                      markTouched={markTouched}
                      onBrowseKey={handleBrowseKey}
                    />
                  )}

                  {common.provider === 's3' && (
                    <S3Fields
                      fieldId={fieldId}
                      isEditing={isEditing}
                      s3={s3}
                      onS3Change={patchS3}
                      visibleError={visibleError}
                      markTouched={markTouched}
                    />
                  )}

                  {/* Color Tag */}
                  <div>
                    <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Palette className="size-3.5" />
                      Color Tag
                    </label>
                    <div className="flex gap-2.5" role="radiogroup" aria-label="Color tag">
                      {COLOR_OPTIONS.map((color) => (
                        <button
                          key={color.hex}
                          type="button"
                          role="radio"
                          aria-checked={common.colorTag === color.hex}
                          aria-label={color.name}
                          onClick={() => setColorTag(color.hex)}
                          className={cn(
                            'relative size-7 rounded-full cursor-pointer',
                            common.colorTag === color.hex
                              ? 'ring-2 ring-ring ring-offset-2 ring-offset-card'
                              : 'hover:scale-110',
                          )}
                          style={{ backgroundColor: color.hex }}
                        >
                          {common.colorTag === color.hex && (
                            <Check className="absolute inset-0 m-auto size-3.5 text-white drop-shadow-sm" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Folder / Group */}
                  <FormField
                    label="Group"
                    icon={<FolderClosed className="size-3.5" />}
                    optional
                    id={`${fieldId}-group`}
                  >
                    <div className="space-y-3">
                      <div className="relative group/input">
                        <input
                          id={`${fieldId}-group`}
                          type="text"
                          value={common.folder === 'default' ? '' : common.folder}
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
                          <FolderClosed className="size-4" />
                        </div>

                        {common.folder !== 'default' && (
                          <button
                            type="button"
                            onClick={() => setFolder('default')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
                            title="Clear group"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}

                        <AnimatePresence>
                          {showGroupsDropdown && filteredFolders.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.98 }}
                              className={cn(
                                'absolute top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl backdrop-blur-sm scrollbar-none',
                                Z.dropdown,
                              )}
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
                                    common.folder === f
                                      ? 'bg-primary/10 text-primary'
                                      : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                                  )}
                                >
                                  <FolderClosed className="size-3.5 opacity-50" />
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
                                onClick={() => setFolder(common.folder === f ? 'default' : f)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border shadow-xs',
                                  common.folder === f ||
                                    (f === 'default' && common.folder === 'default')
                                    ? 'bg-primary/5 border-primary/40 text-primary shadow-[0_0_12px_-3px_rgba(99,102,241,0.2)] ring-1 ring-primary/20'
                                    : 'bg-muted/10 border-border/40 text-muted-foreground hover:bg-muted/20 hover:border-border/60 hover:text-foreground',
                                )}
                              >
                                <FolderClosed
                                  className={cn(
                                    'size-3 transition-opacity',
                                    common.folder === f ||
                                      (f === 'default' && common.folder === 'default')
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

                {/* Inline test result — persistent panel above the footer so
                    users can read success/failure at their own pace instead of
                    relying on a toast that auto-dismisses. */}
                {testResult && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={cn(
                      'mx-5 mb-3 flex items-start gap-2.5 rounded-lg border px-3 py-2',
                      testResult.status === 'success'
                        ? 'border-success/30 bg-success/5'
                        : 'border-destructive/30 bg-destructive/5',
                    )}
                  >
                    {testResult.status === 'success' ? (
                      <CheckCircle2
                        className="size-4 shrink-0 text-success mt-0.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertCircle
                        className="size-4 shrink-0 text-destructive-fg mt-0.5"
                        aria-hidden="true"
                      />
                    )}
                    <p
                      className={cn(
                        'flex-1 text-xs leading-relaxed',
                        testResult.status === 'success' ? 'text-foreground' : 'text-destructive-fg',
                      )}
                    >
                      {testResult.message}
                    </p>
                    <button
                      type="button"
                      onClick={clearTestResult}
                      aria-label="Dismiss test result"
                      className="btn-icon !p-0.5 !min-w-0 !min-h-0 -mr-0.5 -mt-0.5"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                )}

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
                      <Spinner size="sm" className="text-primary" />
                    ) : (
                      <Wifi className="size-3.5" />
                    )}
                    <span className={cn(testing && 'font-semibold')}>
                      {testing ? 'Cancel test' : 'Test connection'}
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
                      {(isSaving || connectionsLoading) && <Spinner size="sm" className="mr-2" />}
                      {isEditing ? 'Update Connection' : 'Create Connection'}
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
