import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Connection, CreateConnectionInput, UpdateConnectionInput } from '@shared/types/ipc';

export function useConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: () => window.api.connections.list(),
    staleTime: Infinity,
  });
}

export function useConnection(id: string | null) {
  return useQuery<Connection | null>({
    queryKey: ['connections', id],
    queryFn: () => (id ? window.api.connections.get(id) : null),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectionInput) => window.api.connections.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateConnectionInput) => window.api.connections.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.api.connections.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}

export function useReorderConnections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => window.api.connections.reorder(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
  });
}
