/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Eye,
  EyeOff,
  FileKey,
  FolderClosed,
  Globe,
  Hash,
  Key,
  Loader2,
  Lock,
  Palette,
  Server,
  Terminal as TerminalIcon,
  User,
  Wifi,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/stores/connection-store';
import {
  useConnection,
  useConnections,
  useCreateConnection,
  useUpdateConnection,
} from '@/hooks/use-connections';
import type { AuthType } from '@shared/types/connection';
import { toast } from 'sonner';

const AUTH_TYPES: { value: AuthType; label: string; icon: React.ReactNode }[] = [
  { value: 'password', label: 'Password', icon: <Lock className="h-4 w-4" /> },
  { value: 'key', label: 'SSH Key', icon: <Key className="h-4 w-4" /> },
  {
    value: 'key+passphrase',
    label: 'Key + Pass',
    icon: <FileKey className="h-4 w-4" />,
  },
];

const COLOR_OPTIONS: { hex: string; name: string }[] = [
  { hex: '#22c55e', name: 'Green' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#f43f5e', name: 'Rose' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#ec4899', name: 'Pink' },
];

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.15 } },
};

export function ConnectionForm() {
  const { connectionFormOpen, editingConnectionId, duplicatingConnectionId, closeForm } =
    useConnectionStore();
  const { data: editingConnection } = useConnection(editingConnectionId);
  const { data: duplicatingConnection } = useConnection(duplicatingConnectionId);
  const { data: existingConnections } = useConnections();
  const createMutation = useCreateConnection();
  const updateMutation = useUpdateConnection();

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [folder, setFolder] = useState('default');
  const [colorTag, setColorTag] = useState<string>(COLOR_OPTIONS[0].hex);
  const [startupCommand, setStartupCommand] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showGroupsDropdown, setShowGroupsDropdown] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const isEditing = !!editingConnectionId;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const uniqueFolders = useMemo(() => {
    if (!existingConnections) return [];
    const folders = new Set(existingConnections.map((c) => c.folder).filter(Boolean));
    return Array.from(folders).sort();
  }, [existingConnections]);

  const filteredFolders = useMemo(() => {
    const search = folder === 'default' ? '' : folder.toLowerCase();
    return uniqueFolders.filter((f) => f.toLowerCase().includes(search));
  }, [uniqueFolders, folder]);

  // Focus trap + Escape
  useEffect(() => {
    if (!connectionFormOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeForm();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connectionFormOpen, closeForm]);

  const resetForm = useCallback(() => {
    setName('');
    setHost('');
    setPort('22');
    setUsername('');
    setAuthType('password');
    setPassword('');
    setPrivateKeyPath('');
    setPassphrase('');
    setFolder('default');
    setColorTag(COLOR_OPTIONS[0].hex);
    setStartupCommand('');
    setShowPassword(false);
    setTouched({});
  }, []);

  useEffect(() => {
    const source = editingConnection || duplicatingConnection;
    if (source) {
      setName(duplicatingConnection ? `${source.name} (copy)` : source.name);
      setHost(source.host);
      setPort(String(source.port));
      setUsername(source.username);
      setAuthType(source.authType);
      setPrivateKeyPath(source.privateKeyPath || '');
      setFolder(source.folder);
      setColorTag(source.colorTag || COLOR_OPTIONS[0].hex);
      setStartupCommand(source.startupCommand || '');
      setPassword('');
      setPassphrase('');
    } else {
      resetForm();
    }
    setTouched({});
  }, [editingConnection, duplicatingConnection, connectionFormOpen, resetForm]);

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const errors: Record<string, string> = {};
  if (!name.trim()) {
    errors.name = 'Connection name is required';
  } else if (
    existingConnections?.some(
      (c) =>
        c.name.trim().toLowerCase() === name.trim().toLowerCase() && c.id !== editingConnectionId,
    )
  ) {
    errors.name = 'A connection with this name already exists';
  }
  if (!host.trim()) {
    errors.host = 'Host is required';
  }
  const portNum = parseInt(port, 10);
  if (port.trim() === '' || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    errors.port = 'Port must be between 1 and 65535';
  }
  if (!username.trim()) {
    errors.username = 'Username is required';
  }
  if ((authType === 'key' || authType === 'key+passphrase') && !privateKeyPath.trim()) {
    errors.privateKeyPath = 'Private key path is required';
  }

  const visibleError = (field: string): string | undefined =>
    touched[field] ? errors[field] : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({
      name: true,
      host: true,
      port: true,
      username: true,
      privateKeyPath: true,
    });

    if (Object.keys(errors).length > 0) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    const data = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port) || 22,
      username: username.trim(),
      authType,
      privateKeyPath: privateKeyPath || undefined,
      password: password || undefined,
      passphrase: passphrase || undefined,
      folder: folder.trim() || 'default',
      colorTag,
      startupCommand: startupCommand.trim() || undefined,
    };

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: editingConnectionId!, ...data });
        toast.success('Connection updated');
      } else {
        await createMutation.mutateAsync(data);
        toast.success('Connection created');
      }
      closeForm();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save connection');
    }
  }

  async function handleTest() {
    if (!isEditing || !editingConnectionId) {
      toast.info('Save the connection first, then test it');
      return;
    }
    setTesting(true);
    try {
      const result = await window.api.ssh.testConnection({ connectionId: editingConnectionId });
      if (result.ok) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error || 'Connection failed');
      }
    } finally {
      setTesting(false);
    }
  }

  async function handleBrowseKey() {
    const path = await window.api.shell.openFileDialog({
      filters: [{ name: 'SSH Keys', extensions: ['pem', 'key', 'pub', ''] }],
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
            onClick={closeForm}
          />

          {/* Dialog */}
          <motion.div
            variants={dialogVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="no-drag fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={closeForm}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="connection-form-title"
              className="no-drag w-full max-w-lg rounded-xl border border-border/80 bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
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
                <button onClick={closeForm} className="btn-icon" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
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

                {/* Host + Port */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <FormField
                      label="Host"
                      icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}
                      required
                      id={`${fieldId}-host`}
                      error={visibleError('host')}
                    >
                      <input
                        id={`${fieldId}-host`}
                        type="text"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        onBlur={() => markTouched('host')}
                        placeholder="192.168.1.100"
                        aria-invalid={!!visibleError('host')}
                        aria-describedby={
                          visibleError('host') ? `${fieldId}-host-error` : undefined
                        }
                        className={cn(
                          'form-input',
                          visibleError('host') && 'border-destructive/60 focus:border-destructive',
                        )}
                      />
                    </FormField>
                  </div>
                  <FormField
                    label="Port"
                    icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}
                    id={`${fieldId}-port`}
                    error={visibleError('port')}
                  >
                    <input
                      id={`${fieldId}-port`}
                      type="number"
                      min={1}
                      max={65535}
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      onBlur={() => markTouched('port')}
                      placeholder="22"
                      aria-invalid={!!visibleError('port')}
                      aria-describedby={visibleError('port') ? `${fieldId}-port-error` : undefined}
                      className={cn(
                        'form-input',
                        visibleError('port') && 'border-destructive/60 focus:border-destructive',
                      )}
                    />
                  </FormField>
                </div>

                {/* Username */}
                <FormField
                  label="Username"
                  icon={<User className="h-3.5 w-3.5" aria-hidden="true" />}
                  required
                  id={`${fieldId}-user`}
                  error={visibleError('username')}
                >
                  <input
                    id={`${fieldId}-user`}
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onBlur={() => markTouched('username')}
                    placeholder="root"
                    aria-invalid={!!visibleError('username')}
                    aria-describedby={
                      visibleError('username') ? `${fieldId}-user-error` : undefined
                    }
                    className={cn(
                      'form-input',
                      visibleError('username') && 'border-destructive/60 focus:border-destructive',
                    )}
                  />
                </FormField>

                {/* Auth Type */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Key className="h-3.5 w-3.5" />
                    Authentication
                  </label>
                  <div
                    className="grid grid-cols-3 gap-2"
                    role="radiogroup"
                    aria-label="Authentication type"
                  >
                    {AUTH_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        role="radio"
                        aria-checked={authType === type.value}
                        onClick={() => setAuthType(type.value)}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer',
                          authType === type.value
                            ? 'border-ring bg-accent text-foreground shadow-xs'
                            : 'border-border text-muted-foreground hover:border-ring/50 hover:bg-accent/50',
                        )}
                      >
                        {type.icon}
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Password / Key fields */}
                <AnimatePresence mode="wait">
                  {authType === 'password' && (
                    <motion.div
                      key="password"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <FormField
                        label="Password"
                        icon={<Lock className="h-3.5 w-3.5" />}
                        id={`${fieldId}-pass`}
                      >
                        <div className="relative">
                          <input
                            id={`${fieldId}-pass`}
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={isEditing ? '(unchanged)' : 'Enter password'}
                            className="form-input pr-9"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </FormField>
                    </motion.div>
                  )}

                  {(authType === 'key' || authType === 'key+passphrase') && (
                    <motion.div
                      key="key"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-4"
                    >
                      <FormField
                        label="Private Key Path"
                        icon={<FileKey className="h-3.5 w-3.5" aria-hidden="true" />}
                        required
                        id={`${fieldId}-key`}
                        error={visibleError('privateKeyPath')}
                      >
                        <div className="flex gap-2">
                          <input
                            id={`${fieldId}-key`}
                            type="text"
                            value={privateKeyPath}
                            onChange={(e) => setPrivateKeyPath(e.target.value)}
                            onBlur={() => markTouched('privateKeyPath')}
                            placeholder="~/.ssh/id_rsa"
                            aria-invalid={!!visibleError('privateKeyPath')}
                            aria-describedby={
                              visibleError('privateKeyPath') ? `${fieldId}-key-error` : undefined
                            }
                            className={cn(
                              'form-input flex-1',
                              visibleError('privateKeyPath') &&
                                'border-destructive/60 focus:border-destructive',
                            )}
                          />
                          <button
                            type="button"
                            onClick={handleBrowseKey}
                            className="btn-outline shrink-0"
                          >
                            Browse
                          </button>
                        </div>
                      </FormField>

                      {authType === 'key+passphrase' && (
                        <FormField
                          label="Passphrase"
                          icon={<Lock className="h-3.5 w-3.5" />}
                          id={`${fieldId}-phrase`}
                        >
                          <input
                            id={`${fieldId}-phrase`}
                            type="password"
                            value={passphrase}
                            onChange={(e) => setPassphrase(e.target.value)}
                            placeholder={isEditing ? '(unchanged)' : 'Key passphrase'}
                            className="form-input"
                          />
                        </FormField>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

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
                                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors',
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

                {/* Startup Command */}
                <FormField
                  label="Startup Command"
                  icon={<TerminalIcon className="h-3.5 w-3.5" />}
                  optional
                  id={`${fieldId}-cmd`}
                >
                  <input
                    id={`${fieldId}-cmd`}
                    type="text"
                    value={startupCommand}
                    onChange={(e) => setStartupCommand(e.target.value)}
                    placeholder="cd /var/www && ls -la"
                    className="form-input"
                  />
                </FormField>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 pt-2">
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testing}
                      className="btn-ghost"
                    >
                      {testing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wifi className="h-3.5 w-3.5" />
                      )}
                      {testing ? 'Testing...' : 'Test connection'}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={closeForm} className="btn-ghost">
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      aria-busy={isSaving}
                      className="btn-primary"
                    >
                      {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function FormField({
  label,
  icon,
  children,
  required,
  optional,
  id,
  error,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  id?: string;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        {icon}
        {label}
        {required && (
          <span className="text-destructive/70" aria-hidden="true">
            *
          </span>
        )}
        {optional && <span className="text-muted-foreground/50">(optional)</span>}
      </label>
      {children}
      {error && (
        <p
          id={id ? `${id}-error` : undefined}
          role="alert"
          className="mt-1 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
