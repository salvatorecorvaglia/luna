import { Check, Eye, EyeOff, FolderClosed, Globe, Hash, Key, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FormField } from './FormField';

interface S3FieldsProps {
  fieldId: string;
  isEditing: boolean;
  endpoint: string;
  setEndpoint(v: string): void;
  region: string;
  setRegion(v: string): void;
  defaultBucket: string;
  setDefaultBucket(v: string): void;
  forcePathStyle: boolean;
  setForcePathStyle(v: boolean): void;
  accessKeyId: string;
  setAccessKeyId(v: string): void;
  secretAccessKey: string;
  setSecretAccessKey(v: string): void;
  sessionToken: string;
  setSessionToken(v: string): void;
  showSecretKey: boolean;
  setShowSecretKey(v: boolean): void;
  visibleError(field: string): string | undefined;
  markTouched(field: string): void;
}

export function S3Fields({
  fieldId,
  isEditing,
  endpoint,
  setEndpoint,
  region,
  setRegion,
  defaultBucket,
  setDefaultBucket,
  forcePathStyle,
  setForcePathStyle,
  accessKeyId,
  setAccessKeyId,
  secretAccessKey,
  setSecretAccessKey,
  sessionToken,
  setSessionToken,
  showSecretKey,
  setShowSecretKey,
  visibleError,
  markTouched,
}: S3FieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Endpoint"
          icon={<Globe className="h-3.5 w-3.5" />}
          optional
          id={`${fieldId}-endpoint`}
        >
          <input
            id={`${fieldId}-endpoint`}
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="(blank for AWS)"
            className="form-input"
          />
        </FormField>
        <FormField label="Region" icon={<Hash className="h-3.5 w-3.5" />} id={`${fieldId}-region`}>
          <input
            id={`${fieldId}-region`}
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="Region (e.g. us-east-1)"
            className="form-input"
          />
        </FormField>
      </div>

      <FormField
        label="Access Key ID"
        icon={<Key className="h-3.5 w-3.5" />}
        required={!isEditing}
        id={`${fieldId}-akid`}
        error={visibleError('accessKeyId')}
      >
        <input
          id={`${fieldId}-akid`}
          type="text"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          onBlur={() => markTouched('accessKeyId')}
          placeholder={isEditing ? '(unchanged)' : 'AKIA...'}
          className={cn(
            'form-input',
            visibleError('accessKeyId') && 'border-destructive/60 focus:border-destructive',
          )}
        />
      </FormField>

      <FormField
        label="Secret Access Key"
        icon={<Lock className="h-3.5 w-3.5" />}
        required={!isEditing}
        id={`${fieldId}-sak`}
        error={visibleError('secretAccessKey')}
      >
        <div className="relative">
          <input
            id={`${fieldId}-sak`}
            type={showSecretKey ? 'text' : 'password'}
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            onBlur={() => markTouched('secretAccessKey')}
            placeholder={isEditing ? '(unchanged)' : 'Secret access key'}
            className={cn(
              'form-input pr-9',
              visibleError('secretAccessKey') && 'border-destructive/60 focus:border-destructive',
            )}
          />
          <button
            type="button"
            onClick={() => setShowSecretKey(!showSecretKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
            tabIndex={-1}
          >
            {showSecretKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </FormField>

      <FormField
        label="Session Token"
        icon={<Lock className="h-3.5 w-3.5" />}
        optional
        id={`${fieldId}-stok`}
      >
        <input
          id={`${fieldId}-stok`}
          type="password"
          value={sessionToken}
          onChange={(e) => setSessionToken(e.target.value)}
          placeholder="(STS only)"
          className="form-input"
        />
      </FormField>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <FormField
            label="Default Bucket"
            icon={<FolderClosed className="h-3.5 w-3.5" />}
            optional
            id={`${fieldId}-bucket`}
          >
            <input
              id={`${fieldId}-bucket`}
              type="text"
              value={defaultBucket}
              onChange={(e) => setDefaultBucket(e.target.value)}
              placeholder="my-bucket"
              className="form-input"
            />
          </FormField>
        </div>
        <label className="group flex h-[38.5px] flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 transition-all hover:bg-accent/40 active:scale-[0.98] select-none">
          <div className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-card transition-all group-hover:border-primary/50">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(e) => setForcePathStyle(e.target.checked)}
              className="peer sr-only"
            />
            <div className="absolute inset-0 rounded bg-primary opacity-0 transition-opacity peer-checked:opacity-100" />
            <Check
              className="relative h-3 w-3 text-white scale-0 transition-transform peer-checked:scale-100"
              strokeWidth={3}
            />
          </div>
          <span className="truncate text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
            Path-style URLs (MinIO, R2)
          </span>
        </label>
      </div>
    </div>
  );
}
