import { AnimatePresence, motion } from 'framer-motion';
import { Eye, EyeOff, FileKey, Globe, Hash, Key, Lock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AuthType } from '@shared/types/connection';
import { AUTH_TYPES } from './connection-form.constants';
import { FormField } from './FormField';

interface SftpFieldsProps {
  fieldId: string;
  isEditing: boolean;
  host: string;
  setHost(v: string): void;
  port: string;
  setPort(v: string): void;
  username: string;
  setUsername(v: string): void;
  authType: AuthType;
  setAuthType(v: AuthType): void;
  password: string;
  setPassword(v: string): void;
  privateKeyPath: string;
  setPrivateKeyPath(v: string): void;
  passphrase: string;
  setPassphrase(v: string): void;
  showPassword: boolean;
  setShowPassword(v: boolean): void;
  visibleError(field: string): string | undefined;
  markTouched(field: string): void;
  onBrowseKey(): void;
}

export function SftpFields({
  fieldId,
  isEditing,
  host,
  setHost,
  port,
  setPort,
  username,
  setUsername,
  authType,
  setAuthType,
  password,
  setPassword,
  privateKeyPath,
  setPrivateKeyPath,
  passphrase,
  setPassphrase,
  showPassword,
  setShowPassword,
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
              value={host}
              onChange={(e) => setHost(e.target.value)}
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
                <button type="button" onClick={onBrowseKey} className="btn-outline shrink-0">
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
    </>
  );
}
