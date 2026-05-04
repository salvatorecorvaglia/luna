import {useQuery, useQueryClient} from '@tanstack/react-query'
import type {LocalFileEntry, SftpEntry} from '@shared/types/sftp'

export function useSftpDirectory(sessionId: string | null, path: string) {
  return useQuery<SftpEntry[]>({
    queryKey: ['sftp', sessionId, path],
    queryFn: () => window.api.sftp.list({ sessionId: sessionId!, path }),
    enabled: !!sessionId && !!path,
    staleTime: 30_000,
    retry: 1
  })
}

export function useLocalDirectory(path: string) {
  return useQuery<LocalFileEntry[]>({
    queryKey: ['local-dir', path],
    queryFn: () => window.api.shell.readdir(path),
    enabled: !!path,
    staleTime: 30_000,
    retry: 1
  })
}

export function useInvalidateSftp() {
  const queryClient = useQueryClient()
  return (sessionId: string, path?: string) => {
    if (path) {
      queryClient.invalidateQueries({ queryKey: ['sftp', sessionId, path] })
    } else {
      queryClient.invalidateQueries({ queryKey: ['sftp', sessionId] })
    }
  }
}

export function useInvalidateLocalDir() {
  const queryClient = useQueryClient()
  return (path?: string) => {
    if (path) {
      queryClient.invalidateQueries({ queryKey: ['local-dir', path] })
    } else {
      queryClient.invalidateQueries({ queryKey: ['local-dir'] })
    }
  }
}
