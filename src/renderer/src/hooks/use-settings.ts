import type { AppSettings } from '@shared/types/settings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useSettings() {
  return useQuery<Partial<AppSettings>>({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.getAll(),
    staleTime: 30_000,
  });
}

export function useSetting<K extends keyof AppSettings>(key: K) {
  return useQuery<AppSettings[K] | null>({
    queryKey: ['settings', key],
    // The main process decodes the stored JSON, so this matches the value
    // shape you'd get from `useSettings()[key]`.
    queryFn: () => window.api.settings.get(key) as Promise<AppSettings[K] | null>,
    staleTime: 30_000,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: keyof AppSettings; value: string }) =>
      window.api.settings.set(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
