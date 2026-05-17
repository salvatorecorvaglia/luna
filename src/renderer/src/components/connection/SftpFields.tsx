import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, FileKey, Globe, Hash, Key, Lock, User, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Connection } from '@shared/types/connection';
import { AUTH_TYPES } from './connection-form.constants';
import { FormField } from './FormField';
import type { JumpHostState, Patch, SftpState } from './use-connection-form-state';

interface SftpFieldsProps {
  fieldId: string;
  isEditing: boolean;
  sftp: SftpState;
  onSftpChange: Patch<SftpState>;
  jumpHost: JumpHostState;
  onJumpHostChange: Patch<JumpHostState>;
  /**
   * Connections eligible to act as a jump host. The parent filters out the
   * current connection (no self-reference) and any already-chained
   * connection (single-hop only) before passing the list in.
   */
  jumpHostOptions: Connection[];
  visibleError(field: string): string | undefined;
  markTouched(field: string): void;
  onBrowseKey(): void;
}

export function SftpFields({
  fieldId,
  isEditing,
  sftp,
  onSftpChange,
  jumpHost,
  onJumpHostChange,
  jumpHostOptions,
  visibleError,
  markTouched,
  onBrowseKey,
}: SftpFieldsProps) {
  return (
    <>
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
              value={sftp.host}
              onChange={(e) => onSftpChange({ host: e.target.value })}
              onBlur={() => markTouched('host')}
              placeholder="192.168.1.100"
              aria-invalid={!!visibleError('host')}
              aria-describedby={visibleError('host') ? `${fieldId}-host-error` : undefined}
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
            inputMode="numeric"
            min={1}
            max={65535}
            value={sftp.port}
            onChange={(e) => onSftpChange({ port: e.target.value })}
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
          value={sftp.username}
          onChange={(e) => onSftpChange({ username: e.target.value })}
          onBlur={() => markTouched('username')}
          placeholder="Enter username"
          aria-invalid={!!visibleError('username')}
          aria-describedby={visibleError('username') ? `${fieldId}-user-error` : undefined}
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
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Authentication type">
          {AUTH_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              role="radio"
              aria-checked={sftp.authType === type.value}
              onClick={() => onSftpChange({ authType: type.value })}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer',
                sftp.authType === type.value
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
        {sftp.authType === 'password' && (
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
                  type={sftp.showPassword ? 'text' : 'password'}
                  value={sftp.password}
                  onChange={(e) => onSftpChange({ password: e.target.value })}
                  onBlur={() => markTouched('password')}
                  placeholder={isEditing ? '(unchanged)' : 'Enter password'}
                  className={cn(
                    'form-input pr-9',
                    visibleError('password') && 'border-destructive/60 focus:border-destructive',
                  )}
                />
                <button
                  type="button"
                  onClick={() => onSftpChange({ showPassword: !sftp.showPassword })}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
                  tabIndex={-1}
                >
                  {sftp.showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </FormField>
          </motion.div>
        )}

        {(sftp.authType === 'key' || sftp.authType === 'key+passphrase') && (
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
                  value={sftp.privateKeyPath}
                  onChange={(e) => onSftpChange({ privateKeyPath: e.target.value })}
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
                <button type="button" onClick={onBrowseKey} className="btn-outline shrink-0">
                  Browse
                </button>
              </div>
            </FormField>

            {sftp.authType === 'key+passphrase' && (
              <FormField
                label="Passphrase"
                icon={<Lock className="h-3.5 w-3.5" />}
                id={`${fieldId}-phrase`}
              >
                <input
                  id={`${fieldId}-phrase`}
                  type="password"
                  value={sftp.passphrase}
                  onChange={(e) => onSftpChange({ passphrase: e.target.value })}
                  onBlur={() => markTouched('passphrase')}
                  placeholder={isEditing ? '(unchanged)' : 'Key passphrase'}
                  className="form-input"
                />
              </FormField>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-px bg-border/40 my-2" />

      {/* Jump Host Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Waypoints className="h-3.5 w-3.5" />
            Jump Host / Tunnel
          </label>
          <div className="flex rounded-md bg-muted/50 p-0.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={jumpHost.mode === 'existing'}
              onClick={() => onJumpHostChange({ mode: 'existing' })}
              className={cn(
                'px-2 py-1 text-[10px] font-semibold rounded-[4px] transition-all cursor-pointer',
                jumpHost.mode === 'existing'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Existing
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={jumpHost.mode === 'manual'}
              onClick={() => onJumpHostChange({ mode: 'manual' })}
              className={cn(
                'px-2 py-1 text-[10px] font-semibold rounded-[4px] transition-all cursor-pointer',
                jumpHost.mode === 'manual'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Manual
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {jumpHost.mode === 'existing' ? (
            <motion.div
              key="existing"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
            >
              <FormField
                label="Select Connection"
                icon={<Waypoints className="h-3.5 w-3.5" />}
                optional
                id={`${fieldId}-jump`}
              >
                <select
                  id={`${fieldId}-jump`}
                  value={jumpHost.connectionId}
                  onChange={(e) => onJumpHostChange({ connectionId: e.target.value })}
                  className="form-input"
                >
                  <option value="">None (direct connection)</option>
                  {jumpHostOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.username}@{c.host}:{c.port}
                    </option>
                  ))}
                </select>
              </FormField>
            </motion.div>
          ) : (
            <motion.div
              key="manual"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20"
            >
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormField
                    label="Jump Host"
                    icon={<Globe className="h-3.5 w-3.5" />}
                    id={`${fieldId}-jh-host`}
                    error={visibleError('jumpHostHost')}
                  >
                    <input
                      id={`${fieldId}-jh-host`}
                      type="text"
                      value={jumpHost.host}
                      onChange={(e) => onJumpHostChange({ host: e.target.value })}
                      onBlur={() => markTouched('jumpHostHost')}
                      placeholder="bastion.example.com"
                      className="form-input text-xs"
                    />
                  </FormField>
                </div>
                <FormField
                  label="Port"
                  icon={<Hash className="h-3.5 w-3.5" />}
                  id={`${fieldId}-jh-port`}
                  error={visibleError('jumpHostPort')}
                >
                  <input
                    id={`${fieldId}-jh-port`}
                    type="number"
                    value={jumpHost.port}
                    onChange={(e) => onJumpHostChange({ port: e.target.value })}
                    onBlur={() => markTouched('jumpHostPort')}
                    placeholder="22"
                    className="form-input text-xs"
                  />
                </FormField>
              </div>

              <FormField
                label="Username"
                icon={<User className="h-3.5 w-3.5" />}
                id={`${fieldId}-jh-user`}
                error={visibleError('jumpHostUsername')}
              >
                <input
                  id={`${fieldId}-jh-user`}
                  type="text"
                  value={jumpHost.username}
                  onChange={(e) => onJumpHostChange({ username: e.target.value })}
                  onBlur={() => markTouched('jumpHostUsername')}
                  placeholder="ssh-user"
                  className="form-input text-xs"
                />
              </FormField>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {AUTH_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => onJumpHostChange({ authType: type.value })}
                      className={cn(
                        'flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium rounded-md border transition-all cursor-pointer',
                        jumpHost.authType === type.value
                          ? 'border-ring bg-accent text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent/50',
                      )}
                    >
                      {type.icon}
                      {type.label}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  {jumpHost.authType === 'password' && (
                    <motion.div
                      key="jh-pass"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="relative">
                        <input
                          type={jumpHost.showPassword ? 'text' : 'password'}
                          value={jumpHost.password}
                          onChange={(e) => onJumpHostChange({ password: e.target.value })}
                          onBlur={() => markTouched('jumpHostPassword')}
                          placeholder="Jump host password"
                          className="form-input text-xs pr-9"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onJumpHostChange({ showPassword: !jumpHost.showPassword })
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground cursor-pointer"
                        >
                          {jumpHost.showPassword ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {(jumpHost.authType === 'key' || jumpHost.authType === 'key+passphrase') && (
                    <motion.div
                      key="jh-key"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3"
                    >
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={jumpHost.privateKeyPath}
                          onChange={(e) => onJumpHostChange({ privateKeyPath: e.target.value })}
                          onBlur={() => markTouched('jumpHostPrivateKeyPath')}
                          placeholder="~/.ssh/id_rsa"
                          className={cn(
                            'form-input text-xs flex-1',
                            visibleError('jumpHostPrivateKeyPath') && 'border-destructive/60',
                          )}
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const path = await window.api.shell.openFileDialog({
                              filters: [
                                {
                                  name: 'SSH Keys',
                                  extensions: ['pem', 'key', 'ppk', 'pub', 'p8', 'p8e', 'ssh2', ''],
                                },
                              ],
                            });
                            if (path) onJumpHostChange({ privateKeyPath: path });
                          }}
                          className="btn-outline text-[10px] h-8 shrink-0"
                        >
                          Browse
                        </button>
                      </div>
                      {jumpHost.authType === 'key+passphrase' && (
                        <input
                          type="password"
                          value={jumpHost.passphrase}
                          onChange={(e) => onJumpHostChange({ passphrase: e.target.value })}
                          placeholder="Key passphrase"
                          className="form-input text-xs"
                        />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
