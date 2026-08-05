import type { AppSettings } from '@shared/types/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApi } from '@/services/api';

export function useSettings() {
  return useQuery<Partial<AppSettings>>({
    queryKey: ['settings'],
    queryFn: () => getApi().settings.getAll(),
    staleTime: 30_000,
  });
}

export function useSetting<K extends keyof AppSettings>(key: K) {
  return useQuery<AppSettings[K] | null>({
    queryKey: ['settings', key],
    // The main process decodes the stored JSON, so this matches the value
    // shape you'd get from `useSettings()[key]`.
    queryFn: () => getApi().settings.get(key) as Promise<AppSettings[K] | null>,
    staleTime: 30_000,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: keyof AppSettings; value: string }) =>
      getApi().settings.set(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
