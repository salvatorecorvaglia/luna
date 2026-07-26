import { describe, expect, it } from 'vitest';
import { extractManualJumpHostConfig } from '../jump-host-helper';

describe('extractManualJumpHostConfig', () => {
  it('extracts valid manual jump host config from complete DB row', () => {
    const row = {
      jump_host_host: 'bastion.example.com',
      jump_host_port: 2222,
      jump_host_username: 'admin',
      jump_host_auth_type: 'key',
      jump_host_private_key_path: '/home/user/.ssh/id_rsa',
    };

    const config = extractManualJumpHostConfig(row);
    expect(config).toEqual({
      host: 'bastion.example.com',
      port: 2222,
      username: 'admin',
      authType: 'key',
      privateKeyPath: '/home/user/.ssh/id_rsa',
    });
  });

  it('returns undefined if required jump host fields are missing', () => {
    const rowIncomplete = {
      jump_host_host: 'bastion.example.com',
      jump_host_port: null,
      jump_host_username: 'admin',
      jump_host_auth_type: 'password',
    };

    expect(extractManualJumpHostConfig(rowIncomplete)).toBeUndefined();
    expect(extractManualJumpHostConfig({})).toBeUndefined();
  });
});
