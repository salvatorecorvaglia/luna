import { describe, expect, it } from 'vitest';
import { resolveSftpSession } from '../sftp-session-fallback';
import type { TerminalSession } from '@/stores/terminal-store';
import type { StorageSession } from '@/stores/sftp-store';

function ssh(id: string, connectionId: string, status: TerminalSession['status']): TerminalSession {
  return {
    id,
    connectionId,
    connectionName: connectionId,
    status,
    title: connectionId,
    type: 'ssh',
  };
}

function s3(
  id: string,
  connectionId: string,
  status: StorageSession['status'] = 'connected',
): StorageSession {
  return {
    id,
    connectionId,
    connectionName: connectionId,
    provider: 's3',
    status,
    initialPath: '/',
  };
}

function ssh_(entries: TerminalSession[]): Map<string, TerminalSession> {
  return new Map(entries.map((e) => [e.id, e]));
}
function s3_(entries: StorageSession[]): Map<string, StorageSession> {
  return new Map(entries.map((e) => [e.id, e]));
}

describe('resolveSftpSession — active connection scoped', () => {
  it('returns the connected SSH session for the active connection', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-a', 'connected')]),
      s3_([]),
      'conn-a',
      null,
    );
    expect(out).toBe('s1');
  });

  it('returns null while an SSH session for the active connection is connecting (no silent S3 swap)', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-a', 'connecting')]),
      s3_([s3('r1', 'conn-b')]),
      'conn-a',
      null,
    );
    expect(out).toBeNull();
  });

  it('returns null while an SSH session for the active connection is reconnecting', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-a', 'reconnecting')]),
      s3_([s3('r1', 'conn-a')]),
      'conn-a',
      null,
    );
    expect(out).toBeNull();
  });

  it('falls back to a connected S3 session for the active connection when no SSH is in flight', () => {
    const out = resolveSftpSession(ssh_([]), s3_([s3('r1', 'conn-a')]), 'conn-a', null);
    expect(out).toBe('r1');
  });

  it('does not pick an SSH session belonging to a different connection', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-other', 'connected')]),
      s3_([s3('r1', 'conn-a')]),
      'conn-a',
      null,
    );
    expect(out).toBe('r1');
  });
});

describe('resolveSftpSession — implicit selection', () => {
  it('picks the first connected SSH session when nothing is active and nothing is selected', () => {
    const out = resolveSftpSession(ssh_([ssh('s1', 'conn-a', 'connected')]), s3_([]), null, null);
    expect(out).toBe('s1');
  });

  it('picks a connected S3 session over no SSH', () => {
    const out = resolveSftpSession(ssh_([]), s3_([s3('r1', 'conn-a')]), null, null);
    expect(out).toBe('r1');
  });

  it('returns null when the user already has a selection (no auto-overwrite)', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-a', 'connected')]),
      s3_([]),
      null,
      's-existing',
    );
    expect(out).toBeNull();
  });

  it('returns null when nothing is connected', () => {
    const out = resolveSftpSession(
      ssh_([ssh('s1', 'conn-a', 'connecting')]),
      s3_([s3('r1', 'conn-a', 'connecting')]),
      null,
      null,
    );
    expect(out).toBeNull();
  });
});
