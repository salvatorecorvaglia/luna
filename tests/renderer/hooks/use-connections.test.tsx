// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useRenameFolder,
  useReorderConnections,
  useUpdateConnection,
} from '../../../src/renderer/src/hooks/use-connections';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const del = vi.fn();
const reorder = vi.fn();
const renameFolder = vi.fn();

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  update.mockReset();
  del.mockReset();
  reorder.mockReset();
  renameFolder.mockReset();
  // window.api is set up at module load by the harness; here we just
  // (re-)assign the connections facade so each test starts clean.
  (globalThis as unknown as { window: Window }).window =
    (globalThis as unknown as { window: Window }).window ||
    (globalThis as unknown as { window: Window });
  Object.assign(window, {
    api: {
      connections: { list, get: vi.fn(), create, update, delete: del, reorder, renameFolder },
    },
  });
});

function wrapper({ children }: PropsWithChildren) {
  // A fresh QueryClient per test isolates cache state.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useConnections', () => {
  it('fetches the connection list via window.api', async () => {
    list.mockResolvedValue([{ id: 'a', name: 'A' }]);
    const { result } = renderHook(() => useConnections(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ id: 'a', name: 'A' }]);
  });
});

describe('useCreateConnection', () => {
  it('invokes connections.create with the input', async () => {
    create.mockResolvedValue({ id: 'new', name: 'X' });
    const { result } = renderHook(() => useCreateConnection(), { wrapper });
    result.current.mutate({ name: 'X', provider: 'sftp' } as Parameters<
      typeof result.current.mutate
    >[0]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(create).toHaveBeenCalledWith({ name: 'X', provider: 'sftp' });
  });
});

describe('useUpdateConnection', () => {
  it('invokes connections.update', async () => {
    update.mockResolvedValue({ id: 'a', name: 'A2' });
    const { result } = renderHook(() => useUpdateConnection(), { wrapper });
    result.current.mutate({ id: 'a', name: 'A2' } as Parameters<typeof result.current.mutate>[0]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(update).toHaveBeenCalledWith({ id: 'a', name: 'A2' });
  });
});

describe('useDeleteConnection', () => {
  it('invokes connections.delete with the id', async () => {
    del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteConnection(), { wrapper });
    result.current.mutate('a');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(del).toHaveBeenCalledWith('a');
  });
});

describe('useReorderConnections', () => {
  it('invokes connections.reorder with the id list', async () => {
    reorder.mockResolvedValue(undefined);
    const { result } = renderHook(() => useReorderConnections(), { wrapper });
    result.current.mutate(['a', 'b', 'c']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(reorder).toHaveBeenCalledWith(['a', 'b', 'c']);
  });
});

describe('useRenameFolder', () => {
  it('invokes connections.renameFolder with the oldName, newName and provider', async () => {
    renameFolder.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRenameFolder(), { wrapper });
    result.current.mutate({ oldName: 'GroupA', newName: 'GroupB', provider: 'sftp' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(renameFolder).toHaveBeenCalledWith({
      oldName: 'GroupA',
      newName: 'GroupB',
      provider: 'sftp',
    });
  });
});
