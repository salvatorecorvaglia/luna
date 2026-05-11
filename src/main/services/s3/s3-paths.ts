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

/**
 * Defense-in-depth: reject obviously malformed bucket segments before they
 * reach the AWS SDK. We're intentionally lenient (MinIO and other compatible
 * stores allow names that strict AWS rules would reject), but path-traversal
 * sentinels and slashes inside the bucket segment can only arrive via a
 * crafted IPC payload and must never round-trip back to S3.
 */
function isValidBucketSegment(bucket: string): boolean {
  if (!bucket) return false;
  if (bucket === '.' || bucket === '..') return false;
  if (bucket.length > 255) return false;
  // No control chars, no slashes — both are syntactically impossible in S3
  // bucket names and indicate that the parse boundary was misused.
  for (let i = 0; i < bucket.length; i++) {
    const c = bucket.charCodeAt(i);
    if (c < 0x20 || c === 0x2f) return false;
  }
  return true;
}

export function parseS3Path(path: string): S3PathParts {
  if (!path || path === '/') return { bucket: null, key: '' };
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  const slash = trimmed.indexOf('/');
  const bucket = slash === -1 ? trimmed : trimmed.slice(0, slash);
  if (!isValidBucketSegment(bucket)) {
    throw new Error(`Invalid S3 bucket segment in path: ${JSON.stringify(path)}`);
  }
  if (slash === -1) return { bucket, key: '' };
  return { bucket, key: trimmed.slice(slash + 1) };
}

export function joinS3Path(bucket: string, key: string): string {
  if (!key) return `/${bucket}`;
  return `/${bucket}/${key}`;
}
