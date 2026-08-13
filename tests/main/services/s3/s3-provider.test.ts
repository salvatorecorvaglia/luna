import { describe, expect, it } from 'vitest';
import { s3StorageProvider } from '../../../../src/main/services/s3/s3-provider';

describe('S3StorageProvider', () => {
  it('identifies provider kind as s3', () => {
    expect(s3StorageProvider.kind).toBe('s3');
  });

  it('reports false for hasSession with non-existent session', () => {
    expect(s3StorageProvider.hasSession('non-existent-session')).toBe(false);
  });

  it('opens and tracks active sessions', () => {
    const sessionId = 'test-s3-session';
    s3StorageProvider.openSession(sessionId, {
      connectionId: 'conn-1',
      connectionName: 'Test S3',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      endpoint: 'https://s3.amazonaws.com',
      region: 'us-east-1',
    });

    expect(s3StorageProvider.hasSession(sessionId)).toBe(true);

    const sessions = s3StorageProvider.listSessions();
    expect(sessions).toEqual([
      {
        id: sessionId,
        connectionId: 'conn-1',
        connectionName: 'Test S3',
        initialPath: '/',
      },
    ]);

    s3StorageProvider.closeSession(sessionId);
    expect(s3StorageProvider.hasSession(sessionId)).toBe(false);
  });

  it('throws S3StorageError when operating on closed session', async () => {
    await expect(s3StorageProvider.stat('closed-session', '/bucket/key')).rejects.toThrow(
      'S3 session not found: closed-session',
    );
  });
});
