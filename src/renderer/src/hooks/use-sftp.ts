import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalFileEntry } from '@shared/types/sftp';
import type { StorageEntry } from '@shared/types/storage-provider';

/**
 * Provider-agnostic remote directory hook. Routes through the unified
 * `storage:*` IPC layer so the same hook works for SFTP and S3 sessions —
 * the main process resolves the session id to the right backend.
 *
 * Kept under the `useSftpDirectory` name to minimise churn at call sites
 * that haven't been migrated yet.
 */
export function useSftpDirectory(sessionId: string | null, path: string) {
  return useQuery<StorageEntry[]>({
    queryKey: ['storage', sessionId, path],
    queryFn: () => window.api.storage.list({ sessionId: sessionId!, path }),
    enabled: !!sessionId && !!path,
    staleTime: 30_000,
    retry: 1,
  });
}

export const useStorageDirectory = useSftpDirectory;

export function useLocalDirectory(path: string) {
  return useQuery<LocalFileEntry[]>({
    queryKey: ['local-dir', path],
    queryFn: () => window.api.shell.readdir(path),
    enabled: !!path,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useInvalidateSftp() {
  const queryClient = useQueryClient();
  return (sessionId: string, path?: string) => {
    if (path) {
      queryClient.invalidateQueries({ queryKey: ['storage', sessionId, path] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['storage', sessionId] });
    }
  };
}

export const useInvalidateStorage = useInvalidateSftp;

export function useInvalidateLocalDir() {
  const queryClient = useQueryClient();
  return (path?: string) => {
    if (path) {
      queryClient.invalidateQueries({ queryKey: ['local-dir', path] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['local-dir'] });
    }
  };
}
