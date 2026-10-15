import type { LocalFileEntry } from '@shared/types/sftp';
import type { StorageEntry } from '@shared/types/storage-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getApi } from '@/services/api';

/**
 * Provider-agnostic remote directory hook. Routes through the unified
 * `storage:*` IPC layer so the same hook works for SFTP and S3 sessions —
 * the main process resolves the session id to the right backend.
 *
 * Kept under the `useSftpDirectory` name to minimise churn at call sites
 * that haven't been migrated yet.
 */
export function useSftpDirectory(
  sessionId: string | null,
  path: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery<StorageEntry[]>({
    queryKey: ['storage', sessionId, path],
    queryFn: () => getApi().storage.list({ sessionId: sessionId!, path }),
    enabled: (options.enabled ?? true) && !!sessionId && !!path,
    staleTime: 60_000,
    retry: false,
  });
}

export function useLocalDirectory(path: string) {
  return useQuery<LocalFileEntry[]>({
    queryKey: ['local-dir', path],
    queryFn: () => getApi().shell.readdir(path),
    enabled: !!path,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Both invalidators are memoised on the query client. They were fresh arrows
 * on every render, and useTransferEventListener lists them as effect deps — so
 * every App re-render (view switch, dialog open, theme change) tore down and
 * re-added all four transfer listeners, cancelled the pending rAF and dropped
 * the progress samples it was holding.
 */
export function useInvalidateSftp() {
  const queryClient = useQueryClient();
  return useCallback(
    (sessionId: string, path?: string) => {
      if (path) {
        void queryClient.invalidateQueries({ queryKey: ['storage', sessionId, path] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['storage', sessionId] });
      }
    },
    [queryClient],
  );
}

export function useInvalidateLocalDir() {
  const queryClient = useQueryClient();
  return useCallback(
    (path?: string) => {
      if (path) {
        void queryClient.invalidateQueries({ queryKey: ['local-dir', path] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['local-dir'] });
      }
    },
    [queryClient],
  );
}
