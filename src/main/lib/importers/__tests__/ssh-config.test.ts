import { describe, expect, it } from 'vitest';
import { parseSshConfig } from '../ssh-config';

describe('SSH Config Importer', () => {
  it('should parse standard SSH configuration files correctly', () => {
    const configContent = `
# Global defaults or ignored commands
ForwardAgent yes
SendEnv LANG LC_*

Host my-server
    HostName 192.168.1.50
    User ubuntu
    Port 2222
    IdentityFile ~/.ssh/id_rsa

# Commented out host should be ignored
# Host commented-server
#    HostName 10.0.0.1

Host another-server
    HostName example.com
    User admin
    # No custom port or identity file
    `;

    const result = parseSshConfig(configContent);
    expect(result).toHaveLength(2);

    expect(result[0].name).toBe('my-server');
    expect(result[0].host).toBe('192.168.1.50');
    expect(result[0].username).toBe('ubuntu');
    expect(result[0].port).toBe(2222);
    expect(result[0].authType).toBe('key');
    expect(result[0].privateKeyPath).toContain('.ssh/id_rsa'); // Tilde expansion resolves home path

    expect(result[1].name).toBe('another-server');
    expect(result[1].host).toBe('example.com');
    expect(result[1].username).toBe('admin');
    expect(result[1].port).toBe(22); // Default fallback
    expect(result[1].authType).toBe('password');
    expect(result[1].privateKeyPath).toBeUndefined();
  });

  it('should skip wildcard hosts', () => {
    const configContent = `
Host *
    ForwardAgent no

Host 192.168.1.*
    User root

Host valid-host
    HostName localhost
    User developer
    `;
    const result = parseSshConfig(configContent);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('valid-host');
  });

  it('should support equals sign parameter separators', () => {
    const configContent = `
Host server-eq
    HostName=192.168.0.25
    User=root
    Port=222
    IdentityFile = ~/keys/key.pem
    `;
    const result = parseSshConfig(configContent);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('server-eq');
    expect(result[0].host).toBe('192.168.0.25');
    expect(result[0].username).toBe('root');
    expect(result[0].port).toBe(222);
    expect(result[0].authType).toBe('key');
    expect(result[0].privateKeyPath).toContain('keys/key.pem');
  });
});
