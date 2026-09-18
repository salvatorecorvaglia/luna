// @vitest-environment jsdom

import type { Connection } from '@shared/types/connection';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConnectionFormState } from '../../../../src/renderer/src/components/connection/use-connection-form-state';

describe('useConnectionFormState', () => {
  const initialColor = '#ff0000';

  it('should initialize with default states', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor, { isEditing: false }));

    expect(result.current.common.name).toBe('');
    expect(result.current.common.provider).toBe('sftp');
    expect(result.current.common.colorTag).toBe(initialColor);
    expect(result.current.common.folder).toBe('default');

    expect(result.current.sftp.host).toBe('');
    expect(result.current.sftp.port).toBe('22');
    expect(result.current.sftp.authType).toBe('password');

    expect(result.current.s3.protocol).toBe('https');
    expect(result.current.s3.host).toBe('');
    expect(result.current.s3.port).toBe('');
  });

  it('should apply partial state updates via patch functions', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor, { isEditing: false }));

    act(() => {
      result.current.patchCommon({ name: 'My Connection', folder: 'custom' });
    });
    expect(result.current.common.name).toBe('My Connection');
    expect(result.current.common.folder).toBe('custom');

    act(() => {
      result.current.patchSftp({ host: 'localhost', port: '2222' });
    });
    expect(result.current.sftp.host).toBe('localhost');
    expect(result.current.sftp.port).toBe('2222');

    act(() => {
      result.current.patchS3({ host: 's3.example.com', region: 'us-west-2' });
    });
    expect(result.current.s3.host).toBe('s3.example.com');
    expect(result.current.s3.region).toBe('us-west-2');
  });

  it('should support resetting the form to defaults', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor, { isEditing: false }));

    act(() => {
      result.current.patchCommon({ name: 'Changed' });
      result.current.patchSftp({ host: 'some-host' });
      result.current.resetForm();
    });

    expect(result.current.common.name).toBe('');
    expect(result.current.sftp.host).toBe('');
  });

  it('should clear secret credentials with clearSecrets', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor, { isEditing: false }));

    act(() => {
      result.current.patchSftp({ password: 'pwd', passphrase: 'pass' });
      result.current.patchS3({ accessKeyId: 'ak', secretAccessKey: 'sak', sessionToken: 'tok' });
    });

    act(() => {
      result.current.clearSecrets();
    });

    expect(result.current.sftp.password).toBe('');
    expect(result.current.sftp.passphrase).toBe('');
    expect(result.current.s3.accessKeyId).toBe('');
    expect(result.current.s3.secretAccessKey).toBe('');
    expect(result.current.s3.sessionToken).toBe('');
  });

  describe('fieldErrors', () => {
    it('flags required SFTP fields when creating', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: false }),
      );

      act(() => {
        result.current.patchSftp({ host: '', port: '', username: '', password: '' });
      });

      expect(result.current.fieldErrors.host).toBe('Host is required');
      expect(result.current.fieldErrors.port).toBeDefined();
      expect(result.current.fieldErrors.username).toBe('Username is required');
      expect(result.current.fieldErrors.password).toBe('Password is required');
    });

    it('does not require a password when editing', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: true }),
      );

      act(() => {
        result.current.patchSftp({
          host: 'localhost',
          port: '22',
          username: 'ubuntu',
          password: '',
        });
      });

      expect(result.current.fieldErrors.password).toBeUndefined();
    });

    it('surfaces the private-key probe error passed in via options', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, {
          isEditing: false,
          privateKeyProbeError: 'Private key file not found',
        }),
      );

      act(() => {
        result.current.patchCommon({ provider: 'sftp' });
        result.current.patchSftp({ authType: 'key', privateKeyPath: '~/.ssh/id_rsa' });
      });

      expect(result.current.fieldErrors.privateKeyPath).toBe('Private key file not found');
    });

    it('flags required S3 credentials when creating', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: false }),
      );

      act(() => {
        result.current.patchCommon({ provider: 's3' });
      });

      expect(result.current.fieldErrors.accessKeyId).toBe('Access Key ID is required');
      expect(result.current.fieldErrors.secretAccessKey).toBe('Secret Access Key is required');
    });
  });

  describe('reseedFromConnection', () => {
    it('should reseed standard SFTP connection', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: false }),
      );
      const sourceConn: Connection = {
        id: 'conn-1',
        name: 'Server 1',
        provider: 'sftp',
        host: '1.2.3.4',
        port: 2222,
        username: 'ubuntu',
        authType: 'key',
        privateKeyPath: '~/.ssh/id_rsa',
        folder: 'servers',
        colorTag: '#00ff00',
        sortOrder: 0,
        isHidden: false,
        createdAt: 0,
        updatedAt: 0,
      };

      act(() => {
        result.current.reseedFromConnection(sourceConn, { isDuplicate: false });
      });

      expect(result.current.common.name).toBe('Server 1');
      expect(result.current.common.provider).toBe('sftp');
      expect(result.current.common.colorTag).toBe('#00ff00');
      expect(result.current.common.folder).toBe('servers');

      expect(result.current.sftp.host).toBe('1.2.3.4');
      expect(result.current.sftp.port).toBe('2222');
      expect(result.current.sftp.username).toBe('ubuntu');
      expect(result.current.sftp.authType).toBe('key');
      expect(result.current.sftp.privateKeyPath).toBe('~/.ssh/id_rsa');
    });

    it('should append (copy) to name when duplicating', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: false }),
      );
      const sourceConn: Connection = {
        id: 'conn-1',
        name: 'Server 1',
        provider: 'sftp',
        host: '1.2.3.4',
        port: 22,
        username: 'ubuntu',
        authType: 'password',
        folder: 'servers',
        sortOrder: 0,
        isHidden: false,
        createdAt: 0,
        updatedAt: 0,
      };

      act(() => {
        result.current.reseedFromConnection(sourceConn, { isDuplicate: true });
      });

      expect(result.current.common.name).toBe('Server 1 (copy)');
    });

    it('should parse S3 endpoints with protocol, host, and port correctly during reseed', () => {
      const { result } = renderHook(() =>
        useConnectionFormState(initialColor, { isEditing: false }),
      );
      const sourceConn: Connection = {
        id: 's3-1',
        name: 'MinIO',
        provider: 's3',
        host: '',
        port: 22,
        username: '',
        authType: 'password',
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        defaultBucket: 'my-bucket',
        forcePathStyle: true,
        folder: 'storage',
        sortOrder: 0,
        isHidden: false,
        createdAt: 0,
        updatedAt: 0,
      };

      act(() => {
        result.current.reseedFromConnection(sourceConn, { isDuplicate: false });
      });

      expect(result.current.common.name).toBe('MinIO');
      expect(result.current.common.provider).toBe('s3');
      expect(result.current.s3.protocol).toBe('http');
      expect(result.current.s3.host).toBe('localhost');
      expect(result.current.s3.port).toBe('9000');
      expect(result.current.s3.region).toBe('us-east-1');
      expect(result.current.s3.defaultBucket).toBe('my-bucket');
      expect(result.current.s3.forcePathStyle).toBe(true);
    });
  });
});
