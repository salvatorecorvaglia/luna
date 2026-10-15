/** Join a remote (POSIX) directory and an entry name without doubling the root slash. */
export function joinRemotePath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`;
}
