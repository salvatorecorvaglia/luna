/**
 * Path convention used by the S3 provider:
 *   "/"                       → root: list buckets
 *   "/bucket"                 → bucket root: list top-level keys + prefixes
 *   "/bucket/foo/bar"         → key "foo/bar" (or prefix "foo/bar/")
 *
 * S3 itself has no notion of directories — "prefix" entries are synthesized
 * from `CommonPrefixes` returned by ListObjectsV2 with `Delimiter='/'`.
 */
export interface S3PathParts {
  /** Bucket name, or null for the virtual root. */
  bucket: string | null;
  /** Key without leading slash. Empty string when at the bucket root. */
  key: string;
}

export function parseS3Path(path: string): S3PathParts {
  if (!path || path === '/') return { bucket: null, key: '' };
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  const slash = trimmed.indexOf('/');
  if (slash === -1) return { bucket: trimmed, key: '' };
  return { bucket: trimmed.slice(0, slash), key: trimmed.slice(slash + 1) };
}

export function joinS3Path(bucket: string, key: string): string {
  if (!key) return `/${bucket}`;
  return `/${bucket}/${key}`;
}
