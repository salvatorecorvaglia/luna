import { describe, expect, it } from 'vitest';
import { importFromMobaXterm } from '../../../../src/main/services/importers/mobaxterm';

function sshLine(opts: { host: string; port: number; user: string; keyPath?: string }): string {
  const parts: string[] = new Array(21).fill('');
  parts[0] = '#109#0';
  parts[1] = opts.host;
  parts[2] = String(opts.port);
  parts[3] = opts.user;
  if (opts.keyPath) parts[14] = opts.keyPath;
  return parts.join('%');
}

describe('importFromMobaXterm', () => {
  it('imports MobaXterm SSH sessions correctly', () => {
    const ini = [
      '[Bookmarks]',
      'SubRep=Servers',
      'web1=' +
        sshLine({
          host: 'web1.internal',
          port: 22,
          user: 'deploy',
        }),
      'web2=' +
        sshLine({
          host: 'web2.internal',
          port: 2222,
          user: 'admin',
        }),
    ].join('\n');

    const conns = importFromMobaXterm(ini);
    expect(conns).toHaveLength(2);

    expect(conns[0]).toEqual({
      name: 'web1',
      provider: 'sftp',
      host: 'web1.internal',
      port: 22,
      username: 'deploy',
      authType: 'password',
      privateKeyPath: undefined,
      folder: 'Servers',
    });

    expect(conns[1]).toEqual({
      name: 'web2',
      provider: 'sftp',
      host: 'web2.internal',
      port: 2222,
      username: 'admin',
      authType: 'password',
      privateKeyPath: undefined,
      folder: 'Servers',
    });
  });
});
