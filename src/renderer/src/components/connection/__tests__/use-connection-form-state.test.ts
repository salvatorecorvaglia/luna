// @vitest-environment jsdom

import type { Connection } from '@shared/types/connection';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConnectionFormState } from '../use-connection-form-state';

describe('useConnectionFormState', () => {
  const initialColor = '#ff0000';

  it('should initialize with default states', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor));

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

    expect(result.current.jumpHost.mode).toBe('existing');
    expect(result.current.jumpHost.port).toBe('22');
  });

  it('should apply partial state updates via patch functions', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor));

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

    act(() => {
      result.current.patchJumpHost({ mode: 'manual', host: 'bastion' });
    });
    expect(result.current.jumpHost.mode).toBe('manual');
    expect(result.current.jumpHost.host).toBe('bastion');
  });

  it('should support resetting the form to defaults', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor));

    act(() => {
      result.current.patchCommon({ name: 'Changed' });
      result.current.patchSftp({ host: 'some-host' });
      result.current.resetForm();
    });

    expect(result.current.common.name).toBe('');
    expect(result.current.sftp.host).toBe('');
  });

  it('should clear secret credentials with clearSecrets', () => {
    const { result } = renderHook(() => useConnectionFormState(initialColor));

    act(() => {
      result.current.patchSftp({ password: 'pwd', passphrase: 'pass' });
      result.current.patchS3({ accessKeyId: 'ak', secretAccessKey: 'sak', sessionToken: 'tok' });
      result.current.patchJumpHost({ password: 'jpwd', passphrase: 'jpass' });
    });

    act(() => {
      result.current.clearSecrets();
    });

    expect(result.current.sftp.password).toBe('');
    expect(result.current.sftp.passphrase).toBe('');
    expect(result.current.s3.accessKeyId).toBe('');
    expect(result.current.s3.secretAccessKey).toBe('');
    expect(result.current.s3.sessionToken).toBe('');
    expect(result.current.jumpHost.password).toBe('');
    expect(result.current.jumpHost.passphrase).toBe('');
  });

  describe('reseedFromConnection', () => {
    it('should reseed standard SFTP connection', () => {
      const { result } = renderHook(() => useConnectionFormState(initialColor));
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
      expect(result.current.jumpHost.mode).toBe('existing');
    });

    it('should append (copy) to name when duplicating', () => {
      const { result } = renderHook(() => useConnectionFormState(initialColor));
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
      const { result } = renderHook(() => useConnectionFormState(initialColor));
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

    it('should parse manual jump host config correctly during reseed', () => {
      const { result } = renderHook(() => useConnectionFormState(initialColor));
      const sourceConn: Connection = {
        id: 'conn-1',
        name: 'Server 1',
        provider: 'sftp',
        host: '1.2.3.4',
        port: 22,
        username: 'ubuntu',
        authType: 'password',
        jumpHostConnectionId: 'bastion-id',
        jumpHostConfig: {
          host: 'bastion.net',
          port: 222,
          username: 'admin',
          authType: 'key+passphrase',
          privateKeyPath: '/keys/bastion',
        },
        folder: 'servers',
        sortOrder: 0,
        isHidden: false,
        createdAt: 0,
        updatedAt: 0,
      };

      act(() => {
        result.current.reseedFromConnection(sourceConn, { isDuplicate: false });
      });

      expect(result.current.jumpHost.mode).toBe('manual');
      expect(result.current.jumpHost.connectionId).toBe('bastion-id');
      expect(result.current.jumpHost.host).toBe('bastion.net');
      expect(result.current.jumpHost.port).toBe('222');
      expect(result.current.jumpHost.username).toBe('admin');
      expect(result.current.jumpHost.authType).toBe('key+passphrase');
      expect(result.current.jumpHost.privateKeyPath).toBe('/keys/bastion');
    });
  });
});
