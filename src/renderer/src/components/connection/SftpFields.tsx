import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Eye,
  EyeOff,
  FileKey,
  Globe,
  Hash,
  Key,
  Lock,
  Plus,
  User,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AUTH_TYPES } from './connection-form.constants';
import { FormField } from './FormField';
import type { Patch, SftpState } from './use-connection-form-state';

interface SftpFieldsProps {
  fieldId: string;
  isEditing: boolean;
  sftp: SftpState;
  onSftpChange: Patch<SftpState>;
  visibleError(field: string): string | undefined;
  markTouched(field: string): void;
  onBrowseKey(): void;
}

export function SftpFields({
  fieldId,
  isEditing,
  sftp,
  onSftpChange,
  visibleError,
  markTouched,
  onBrowseKey,
}: SftpFieldsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState<{
    type: 'local' | 'remote' | 'dynamic';
    bindAddress: string;
    localPort: string;
    remoteHost: string;
    remotePort: string;
  }>({
    type: 'local',
    bindAddress: '127.0.0.1',
    localPort: '',
    remoteHost: 'localhost',
    remotePort: '',
  });

  const handleAddRule = () => {
    const lPort = parseInt(newRule.localPort, 10);
    if (Number.isNaN(lPort) || lPort < 1 || lPort > 65535) {
      toast.error('Local port must be between 1 and 65535');
      return;
    }

    if (newRule.type !== 'dynamic') {
      const rPort = parseInt(newRule.remotePort, 10);
      if (Number.isNaN(rPort) || rPort < 1 || rPort > 65535) {
        toast.error('Destination port must be between 1 and 65535');
        return;
      }
      if (!newRule.remoteHost.trim()) {
        toast.error('Destination host is required');
        return;
      }
    }

    const uuid = window.crypto.randomUUID();
    const addedRule = {
      id: uuid,
      type: newRule.type,
      bindAddress: newRule.bindAddress.trim() || '127.0.0.1',
      localPort: lPort,
      ...(newRule.type !== 'dynamic'
        ? {
            remoteHost: newRule.remoteHost.trim() || 'localhost',
            remotePort: parseInt(newRule.remotePort, 10),
          }
        : {}),
    };

    onSftpChange({
      portForwards: [...(sftp.portForwards || []), addedRule],
    });
    setIsAddingRule(false);
  };

  return (
    <>
      {/* Host + Port */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <FormField
            label="Host"
            icon={<Globe className="size-3.5" aria-hidden="true" />}
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
          icon={<Hash className="size-3.5" aria-hidden="true" />}
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
        icon={<User className="size-3.5" aria-hidden="true" />}
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
          <Key className="size-3.5" />
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
            <FormField label="Password" icon={<Lock className="size-3.5" />} id={`${fieldId}-pass`}>
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
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
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
              icon={<FileKey className="size-3.5" aria-hidden="true" />}
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
                icon={<Lock className="size-3.5" />}
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

      {/* Advanced Settings */}
      <div className="mt-4 border-t border-border/40 pt-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <span>Advanced SSH Settings</span>
          <ChevronDown
            className={cn(
              'size-3.5 transform transition-transform duration-200',
              showAdvanced && 'rotate-180',
            )}
          />
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            {/* Keepalives */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Keepalive Interval (seconds)"
                icon={<Hash className="size-3.5" aria-hidden="true" />}
                id={`${fieldId}-keepalive-interval`}
                error={visibleError('keepaliveInterval')}
              >
                <input
                  id={`${fieldId}-keepalive-interval`}
                  type="number"
                  min={0}
                  value={sftp.keepaliveInterval}
                  onChange={(e) => onSftpChange({ keepaliveInterval: e.target.value })}
                  onBlur={() => markTouched('keepaliveInterval')}
                  placeholder="10"
                  className="form-input text-xs"
                />
              </FormField>
              <FormField
                label="Max Keepalive Count"
                icon={<Hash className="size-3.5" aria-hidden="true" />}
                id={`${fieldId}-keepalive-count`}
                error={visibleError('keepaliveCountMax')}
              >
                <input
                  id={`${fieldId}-keepalive-count`}
                  type="number"
                  min={1}
                  value={sftp.keepaliveCountMax}
                  onChange={(e) => onSftpChange({ keepaliveCountMax: e.target.value })}
                  onBlur={() => markTouched('keepaliveCountMax')}
                  placeholder="3"
                  className="form-input text-xs"
                />
              </FormField>
            </div>

            {/* Port Forwarding rules list */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Port Forwarding Rules
              </label>

              {(sftp.portForwards || []).length > 0 ? (
                <div className="mb-3 space-y-2 rounded-lg border border-border/60 bg-background/30 p-2.5">
                  {(sftp.portForwards || []).map((pf) => (
                    <div
                      key={pf.id}
                      className="flex items-center justify-between rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5 text-xs"
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold capitalize text-foreground flex items-center gap-1.5">
                          {pf.type} forwarding
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {pf.type === 'dynamic'
                            ? `SOCKS5 Server on ${pf.bindAddress}:${pf.localPort}`
                            : pf.type === 'local'
                              ? `Local ${pf.bindAddress}:${pf.localPort} -> Remote ${pf.remoteHost}:${pf.remotePort}`
                              : `Remote ${pf.bindAddress}:${pf.localPort} -> Local ${pf.remoteHost}:${pf.remotePort}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSftpChange({
                            portForwards: sftp.portForwards.filter((x) => x.id !== pf.id),
                          });
                        }}
                        className="text-muted-foreground hover:text-destructive-fg transition-colors cursor-pointer"
                        title="Remove rule"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mb-3 rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                  No port forwarding rules configured.
                </div>
              )}

              {/* Add rule section */}
              {isAddingRule ? (
                <div className="space-y-3 rounded-lg border border-border/60 bg-background/30 p-3">
                  <div className="grid grid-cols-3 gap-2">
                    {/* Rule Type */}
                    <div className="col-span-1">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Type
                      </label>
                      <select
                        value={newRule.type}
                        onChange={(e) =>
                          setNewRule({
                            ...newRule,
                            type: e.target.value as 'local' | 'remote' | 'dynamic',
                          })
                        }
                        className="form-input text-xs h-8 px-1 py-0 bg-background"
                      >
                        <option value="local">Local</option>
                        <option value="remote">Remote</option>
                        <option value="dynamic">Dynamic</option>
                      </select>
                    </div>
                    {/* Bind Address */}
                    <div className="col-span-1">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Bind Address
                      </label>
                      <input
                        type="text"
                        placeholder="127.0.0.1"
                        value={newRule.bindAddress}
                        onChange={(e) => setNewRule({ ...newRule, bindAddress: e.target.value })}
                        className="form-input text-xs h-8"
                      />
                    </div>
                    {/* Local Port */}
                    <div className="col-span-1">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Port
                      </label>
                      <input
                        type="number"
                        placeholder="8080"
                        value={newRule.localPort}
                        onChange={(e) => setNewRule({ ...newRule, localPort: e.target.value })}
                        className="form-input text-xs h-8"
                      />
                    </div>
                  </div>

                  {newRule.type !== 'dynamic' && (
                    <div className="grid grid-cols-3 gap-2">
                      {/* Destination Host */}
                      <div className="col-span-2">
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                          Destination Host
                        </label>
                        <input
                          type="text"
                          placeholder="localhost"
                          value={newRule.remoteHost}
                          onChange={(e) => setNewRule({ ...newRule, remoteHost: e.target.value })}
                          className="form-input text-xs h-8"
                        />
                      </div>
                      {/* Destination Port */}
                      <div className="col-span-1">
                        <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                          Port
                        </label>
                        <input
                          type="number"
                          placeholder="80"
                          value={newRule.remotePort}
                          onChange={(e) => setNewRule({ ...newRule, remotePort: e.target.value })}
                          className="form-input text-xs h-8"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1.5">
                    <button
                      type="button"
                      onClick={() => setIsAddingRule(false)}
                      className="btn-outline h-7 px-3 text-[10px] text-muted-foreground border-border/60 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAddRule}
                      className="btn-primary h-7 px-3 text-[10px] cursor-pointer"
                    >
                      Add Rule
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingRule(true);
                    setNewRule({
                      type: 'local',
                      bindAddress: '127.0.0.1',
                      localPort: '',
                      remoteHost: 'localhost',
                      remotePort: '',
                    });
                  }}
                  className="btn-outline w-full h-8 text-[11px] font-medium hover:bg-accent/40 border-dashed border-border/80 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  Add Port Forwarding Rule
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
