import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Connection, CreateConnectionInput, UpdateConnectionInput } from '@shared/types/ipc';

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => window.api.connections.list(),
    staleTime: 30_000,
  });
}

export function useConnection(id: string | null) {
  return useQuery<Connection | null>({
    queryKey: ['connections', id],
    queryFn: () => (id ? window.api.connections.get(id) : null),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectionInput) => window.api.connections.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateConnectionInput) => window.api.connections.update(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useRenameFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { oldName: string; newName: string; provider: 'sftp' | 's3' }) =>
      window.api.connections.renameFolder(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.api.connections.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useReorderConnections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => window.api.connections.reorder(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
