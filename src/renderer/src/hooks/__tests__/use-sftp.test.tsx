// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useInvalidateLocalDir,
  useInvalidateSftp,
  useLocalDirectory,
  useSftpDirectory,
} from '../use-sftp';

const list = vi.fn();
const readdir = vi.fn();

beforeEach(() => {
  list.mockReset();
  readdir.mockReset();
  Object.assign(window, {
    api: {
      storage: { list },
      shell: { readdir },
    },
  });
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('useSftpDirectory', () => {
  it('does not query when sessionId is null', () => {
    const { result } = renderHook(() => useSftpDirectory(null, '/'), {
      wrapper: makeWrapper(freshClient()),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });

  it('queries storage.list with sessionId and path', async () => {
    list.mockResolvedValue([{ name: 'a', isDirectory: false }]);
    const { result } = renderHook(() => useSftpDirectory('s1', '/home'), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith({ sessionId: 's1', path: '/home' });
  });

  it('honours the enabled option', () => {
    renderHook(() => useSftpDirectory('s1', '/home', { enabled: false }), {
      wrapper: makeWrapper(freshClient()),
    });
    expect(list).not.toHaveBeenCalled();
  });
});

describe('useLocalDirectory', () => {
  it('queries shell.readdir', async () => {
    readdir.mockResolvedValue([]);
    const { result } = renderHook(() => useLocalDirectory('/tmp'), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(readdir).toHaveBeenCalledWith('/tmp');
  });
});

describe('useInvalidateSftp', () => {
  it('targets a specific (session, path) pair when path is provided', async () => {
    const client = freshClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => {
        useQueryClient(); // no-op: ensures provider context wired
        return useInvalidateSftp();
      },
      { wrapper: makeWrapper(client) },
    );
    result.current('s1', '/foo');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['storage', 's1', '/foo'] });
  });

  it('targets the whole session when path is omitted', () => {
    const client = freshClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useInvalidateSftp(), {
      wrapper: makeWrapper(client),
    });
    result.current('s1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['storage', 's1'] });
  });
});

describe('useInvalidateLocalDir', () => {
  it('targets a specific path when provided', () => {
    const client = freshClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useInvalidateLocalDir(), {
      wrapper: makeWrapper(client),
    });
    result.current('/tmp');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['local-dir', '/tmp'] });
  });

  it('falls back to invalidating all local-dir queries', () => {
    const client = freshClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useInvalidateLocalDir(), {
      wrapper: makeWrapper(client),
    });
    result.current();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['local-dir'] });
  });
});
