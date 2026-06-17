import { describe, expect, it } from 'vitest';
import { importFromMobaXterm } from '../mobaxterm';

/**
 * Build a MobaXterm SSH session string. Pads fields to the indices the
 * importer reads (key at 14, gateway at 18-20) using empty strings so
 * positional parsing stays accurate.
 */
function sshLine(opts: {
  host: string;
  port: number;
  user: string;
  keyPath?: string;
  gwHost?: string;
  gwPort?: number;
  gwUser?: string;
}): string {
  const parts: string[] = new Array(21).fill('');
  parts[0] = '#109#0';
  parts[1] = opts.host;
  parts[2] = String(opts.port);
  parts[3] = opts.user;
  if (opts.keyPath) parts[14] = opts.keyPath;
  if (opts.gwHost) parts[18] = opts.gwHost;
  if (opts.gwPort != null) parts[19] = String(opts.gwPort);
  if (opts.gwUser) parts[20] = opts.gwUser;
  return parts.join('%');
}

describe('importFromMobaXterm — jump host', () => {
  it('synthesizes a single bastion connection shared by targets with the same gateway tuple', () => {
    const ini = [
      '[Bookmarks]',
      'SubRep=Servers',
      'web1=' +
        sshLine({
          host: 'web1.internal',
          port: 22,
          user: 'deploy',
          gwHost: 'bastion.example.com',
          gwPort: 22,
          gwUser: 'jumper',
        }),
      'web2=' +
        sshLine({
          host: 'web2.internal',
          port: 22,
          user: 'deploy',
          gwHost: 'bastion.example.com',
          gwPort: 22,
          gwUser: 'jumper',
        }),
    ].join('\n');

    const conns = importFromMobaXterm(ini);
    // 1 synthetic bastion + 2 targets.
    expect(conns).toHaveLength(3);

    const bastion = conns.find((c) => c.host === 'bastion.example.com');
    expect(bastion).toBeDefined();
    expect(bastion?.username).toBe('jumper');
    expect(bastion?.port).toBe(22);
    expect(bastion?.name).toContain('Jump:');

    const targets = conns.filter((c) => c.host !== 'bastion.example.com');
    expect(targets).toHaveLength(2);
    // Both targets reference the *same* synthetic bastion name (single bastion
    // shared across hosts) so the import linker hooks them to one DB row.
    expect(new Set(targets.map((t) => t.jumpHostName))).toEqual(new Set([bastion!.name]));
  });

  it('emits no bastion (and no jumpHostName) when MobaXterm leaves gateway fields empty', () => {
    const ini = [
      '[Bookmarks]',
      // biome-ignore lint/style/useTemplate: suppressed during migration
      'web=' + sshLine({ host: 'web.internal', port: 22, user: 'deploy' }),
    ].join('\n');

    const conns = importFromMobaXterm(ini);
    expect(conns).toHaveLength(1);
    expect(conns[0].host).toBe('web.internal');
    expect(conns[0].jumpHostName).toBeUndefined();
  });

  it('defaults gateway username to the target username when MobaXterm omits it', () => {
    const ini = [
      '[Bookmarks]',
      'web=' +
        sshLine({ host: 'web.internal', port: 22, user: 'deploy', gwHost: 'bastion', gwPort: 22 }),
    ].join('\n');
    const conns = importFromMobaXterm(ini);
    const bastion = conns.find((c) => c.host === 'bastion');
    expect(bastion?.username).toBe('deploy');
  });

  it('avoids collisions with existing bookmark names when synthesizing the bastion label', () => {
    // A bookmark literally named "Jump: deploy@bastion:22" already exists,
    // so the synthetic gateway must pick "Jump: deploy@bastion:22 (2)".
    const ini = [
      '[Bookmarks]',
      // biome-ignore lint/style/useTemplate: suppressed during migration
      'Jump: deploy@bastion:22=' + sshLine({ host: 'unrelated', port: 22, user: 'deploy' }),
      'web=' +
        sshLine({
          host: 'web',
          port: 22,
          user: 'deploy',
          gwHost: 'bastion',
          gwPort: 22,
          gwUser: 'deploy',
        }),
    ].join('\n');
    const conns = importFromMobaXterm(ini);
    const synthetic = conns.find((c) => c.host === 'bastion' && c.name.includes('(2)'));
    expect(synthetic).toBeDefined();
  });
});
