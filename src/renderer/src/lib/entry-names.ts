/**
 * Why `name` can't be used as a single remote directory entry, or null if it
 * can. A slash would create or move into a different directory, `.`/`..`
 * refer to existing directories, and control characters break listings.
 * Drag-and-drop already refused these (use-sftp-dnd's sanitizeFilename);
 * rename and "new folder" passed the text straight into the remote path.
 */
export function invalidEntryNameReason(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty';
  if (trimmed === '.' || trimmed === '..') return `"${trimmed}" is not a valid name`;
  if (/[/\\]/.test(trimmed)) return 'Name cannot contain / or \\';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'Name cannot contain control characters';
  return null;
}
