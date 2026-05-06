import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCommandSetInput, UpdateCommandSetInput } from '@shared/types/command-set';

export function useCommandSets() {
  return useQuery({
    queryKey: ['command-sets'],
    queryFn: () => window.api.commandSets.list(),
    staleTime: Infinity,
  });
}

export function useCreateCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommandSetInput) => window.api.commandSets.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}

export function useUpdateCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCommandSetInput) => window.api.commandSets.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}

export function useDeleteCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.api.commandSets.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}
