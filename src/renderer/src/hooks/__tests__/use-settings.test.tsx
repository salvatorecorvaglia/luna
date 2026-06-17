// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetting, useSettings, useUpdateSetting } from '../use-settings';

const getAll = vi.fn();
const get = vi.fn();
const set = vi.fn();

beforeEach(() => {
  getAll.mockReset();
  get.mockReset();
  set.mockReset();
  Object.assign(window, {
    api: {
      settings: { getAll, get, set },
    },
  });
});

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSettings', () => {
  it('fetches the full settings map', async () => {
    getAll.mockResolvedValue({ 'terminal.fontSize': 14 });
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ 'terminal.fontSize': 14 });
  });
});

describe('useSetting', () => {
  it('fetches a single key', async () => {
    get.mockResolvedValue('"dracula"');
    const { result } = renderHook(() => useSetting('terminal.theme'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('terminal.theme');
    expect(result.current.data).toBe('"dracula"');
  });
});

describe('useUpdateSetting', () => {
  it('invokes settings.set with key and value', async () => {
    set.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdateSetting(), { wrapper });
    result.current.mutate({ key: 'terminal.theme', value: '"nord"' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(set).toHaveBeenCalledWith('terminal.theme', '"nord"');
  });
});
