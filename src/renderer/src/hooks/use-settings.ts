import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings } from '@shared/types/settings';

export function useSettings() {
  return useQuery<Partial<AppSettings>>({
    queryKey: ['settings'],
    queryFn: () => window.api.settings.getAll(),
    staleTime: 30_000,
  });
}

export function useSetting<K extends keyof AppSettings>(key: K) {
  return useQuery<string>({
    queryKey: ['settings', key],
    queryFn: () => window.api.settings.get(key),
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
