import { Check, Eye, EyeOff, FolderClosed, Globe, Hash, Key, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FormField } from './FormField';
import { HelpTooltip } from '../common/HelpTooltip';
import type { Patch, S3State } from './use-connection-form-state';

interface S3FieldsProps {
  fieldId: string;
  isEditing: boolean;
  s3: S3State;
  onS3Change: Patch<S3State>;
  visibleError(field: string): string | undefined;
  markTouched(field: string): void;
}

export function S3Fields({
  fieldId,
  isEditing,
  s3,
  onS3Change,
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
            value={s3.endpoint}
            onChange={(e) => onS3Change({ endpoint: e.target.value })}
            onBlur={() => markTouched('endpoint')}
            placeholder="(blank for AWS)"
            className="form-input"
          />
        </FormField>
        <FormField label="Region" icon={<Hash className="h-3.5 w-3.5" />} id={`${fieldId}-region`}>
          <input
            id={`${fieldId}-region`}
            type="text"
            value={s3.region}
            onChange={(e) => onS3Change({ region: e.target.value })}
            onBlur={() => markTouched('region')}
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
          value={s3.accessKeyId}
          onChange={(e) => onS3Change({ accessKeyId: e.target.value })}
          onBlur={() => markTouched('accessKeyId')}
          placeholder={isEditing ? '(unchanged)' : 'Access key'}
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
            type={s3.showSecretKey ? 'text' : 'password'}
            value={s3.secretAccessKey}
            onChange={(e) => onS3Change({ secretAccessKey: e.target.value })}
            onBlur={() => markTouched('secretAccessKey')}
            placeholder={isEditing ? '(unchanged)' : 'Secret access key'}
            className={cn(
              'form-input pr-9',
              visibleError('secretAccessKey') && 'border-destructive/60 focus:border-destructive',
            )}
          />
          <button
            type="button"
            onClick={() => onS3Change({ showSecretKey: !s3.showSecretKey })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
            tabIndex={-1}
          >
            {s3.showSecretKey ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
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
          value={s3.sessionToken}
          onChange={(e) => onS3Change({ sessionToken: e.target.value })}
          onBlur={() => markTouched('sessionToken')}
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
              value={s3.defaultBucket}
              onChange={(e) => onS3Change({ defaultBucket: e.target.value })}
              onBlur={() => markTouched('defaultBucket')}
              placeholder="my-bucket"
              className="form-input"
            />
          </FormField>
        </div>
        <label className="group flex h-[38.5px] flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 transition-all hover:bg-accent/40 active:scale-[0.98] select-none">
          <div className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-card transition-all group-hover:border-primary/50">
            <input
              type="checkbox"
              checked={s3.forcePathStyle}
              onChange={(e) => onS3Change({ forcePathStyle: e.target.checked })}
              className="peer sr-only"
            />
            <div className="absolute inset-0 rounded bg-primary opacity-0 transition-opacity peer-checked:opacity-100" />
            <Check
              className="relative h-3 w-3 text-white scale-0 transition-transform peer-checked:scale-100"
              strokeWidth={3}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Path-style URLs (MinIO, R2)
            </span>
            <HelpTooltip
              content="Use path-style addressing (endpoint/bucket) instead of subdomains. Required for MinIO and R2."
              iconClassName="group-hover:text-muted-foreground/50"
            />
          </div>
        </label>
      </div>
    </div>
  );
}
