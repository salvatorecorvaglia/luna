// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LunaAPI } from '../../../../src/preload';
import type {
  S3State,
  SftpState,
} from '../../../../src/renderer/src/components/connection/use-connection-form-state';
import { useConnectionTest } from '../../../../src/renderer/src/components/connection/use-connection-test';
import { __setApiForTesting } from '../../../../src/renderer/src/services/api';

const baseSftp: SftpState = {
  host: 'example.com',
  port: '22',
  username: 'root',
  authType: 'password',
  password: 'secret',
  privateKeyPath: '',
  passphrase: '',
  showPassword: false,
  keepaliveInterval: '10',
  keepaliveCountMax: '3',
  portForwards: [],
};

const baseS3: S3State = {
  protocol: 'https',
  host: '',
  port: '',
  region: '',
  defaultBucket: '',
  forcePathStyle: false,
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  showSecretKey: false,
};

function setApi(overrides: {
  sshTestConnection?: (...args: unknown[]) => Promise<unknown>;
  s3TestConnection?: (...args: unknown[]) => Promise<unknown>;
}) {
  __setApiForTesting({
    ssh: { testConnection: overrides.sshTestConnection ?? vi.fn() },
    s3: { testConnection: overrides.s3TestConnection ?? vi.fn() },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double, only ssh/s3 are exercised
  } as any as LunaAPI);
}

afterEach(() => {
  __setApiForTesting(null);
});

describe('useConnectionTest — rejection path (regression for a thrown IPC error, not a resolved {ok:false})', () => {
  it('SFTP: surfaces an error result instead of leaving the spinner stuck when the IPC call throws', async () => {
    setApi({ sshTestConnection: vi.fn().mockRejectedValue(new Error('preload bridge crashed')) });
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runTest({
        provider: 'sftp',
        sftp: baseSftp,
        s3: baseS3,
        editingConnectionId: null,
        isEditing: false,
      });
    });

    await waitFor(() => expect(result.current.testing).toBe(false));
    expect(result.current.result).toEqual({
      status: 'error',
      message: 'preload bridge crashed',
    });
  });

  it('S3: surfaces an error result instead of leaving the spinner stuck when the IPC call throws', async () => {
    setApi({ s3TestConnection: vi.fn().mockRejectedValue(new Error('main process exception')) });
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runTest({
        provider: 's3',
        sftp: baseSftp,
        s3: { ...baseS3, accessKeyId: 'AKIA...', secretAccessKey: 'shh' },
        editingConnectionId: null,
        isEditing: false,
      });
    });

    await waitFor(() => expect(result.current.testing).toBe(false));
    expect(result.current.result).toEqual({
      status: 'error',
      message: 'main process exception',
    });
  });

  it('falls back to a generic message when the rejection is not an Error instance', async () => {
    setApi({ sshTestConnection: vi.fn().mockRejectedValue('a bare string rejection') });
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runTest({
        provider: 'sftp',
        sftp: baseSftp,
        s3: baseS3,
        editingConnectionId: null,
        isEditing: false,
      });
    });

    await waitFor(() => expect(result.current.testing).toBe(false));
    expect(result.current.result).toEqual({
      status: 'error',
      message: 'Connection test failed',
    });
  });
});

describe('useConnectionTest — resolved {ok:false} path still works (not broken by the catch addition)', () => {
  it('surfaces the server-provided error message on a resolved failure', async () => {
    setApi({
      sshTestConnection: vi.fn().mockResolvedValue({ ok: false, error: 'Connection refused' }),
    });
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runTest({
        provider: 'sftp',
        sftp: baseSftp,
        s3: baseS3,
        editingConnectionId: null,
        isEditing: false,
      });
    });

    await waitFor(() => expect(result.current.testing).toBe(false));
    expect(result.current.result).toEqual({ status: 'error', message: 'Connection refused' });
  });

  it('surfaces success on a resolved {ok:true}', async () => {
    setApi({ sshTestConnection: vi.fn().mockResolvedValue({ ok: true }) });
    const { result } = renderHook(() => useConnectionTest());

    await act(async () => {
      await result.current.runTest({
        provider: 'sftp',
        sftp: baseSftp,
        s3: baseS3,
        editingConnectionId: null,
        isEditing: false,
      });
    });

    await waitFor(() => expect(result.current.testing).toBe(false));
    expect(result.current.result).toEqual({ status: 'success', message: 'Connection successful' });
  });
});
