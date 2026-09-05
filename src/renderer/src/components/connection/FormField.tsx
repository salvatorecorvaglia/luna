/**
 * Shared label + error wrapper for inputs in the connection form.
 * Lives outside ConnectionForm so SftpFields and S3Fields can use it without
 * a circular import back into the parent.
 */
export function FormField({
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
          <span className="required-mark font-semibold" aria-hidden="true" title="Required">
            *
          </span>
        )}
        {required && <span className="sr-only">required</span>}
        {optional && <span className="text-muted-foreground/70">(optional)</span>}
      </label>
      {children}
      {error && (
        <p id={id ? `${id}-error` : undefined} role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
