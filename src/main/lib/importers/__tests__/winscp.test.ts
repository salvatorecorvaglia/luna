import { describe, expect, it } from 'vitest';
import { importFromWinSCP } from '../winscp';

describe('WinSCP Importer', () => {
  it('should parse standard WinSCP INI sessions correctly', () => {
    const iniContent = `
[Sessions\\test_session]
HostName=192.168.1.100
UserName=admin
PortNumber=22
FSProtocol=0
PublicKeyFile=~/keys/id_rsa

[Sessions\\s3_session]
HostName=s3.example.com
FSProtocol=5
    `;
    const result = importFromWinSCP(iniContent);
    expect(result).toHaveLength(2);

    expect(result[0].name).toBe('test_session');
    expect(result[0].host).toBe('192.168.1.100');
    expect(result[0].username).toBe('admin');
    expect(result[0].port).toBe(22);
    expect(result[0].privateKeyPath).toBe('~/keys/id_rsa');
    expect(result[0].authType).toBe('key');
    expect(result[0].provider).toBe('sftp');

    expect(result[1].name).toBe('s3_session');
    expect(result[1].endpoint).toBe('s3.example.com');
    expect(result[1].provider).toBe('s3');
  });

  it('should parse WinSCP registry export (REG) sessions with dword: format correctly', () => {
    const regContent = `
[Sessions\\reg_sftp]
HostName=localhost
UserName=user
PortNumber=dword:000008ae
FSProtocol=dword:00000000

[Sessions\\reg_s3]
HostName=play.min.io
FSProtocol=dword:00000005
    `;
    const result = importFromWinSCP(regContent);
    expect(result).toHaveLength(2);

    // dword:000008ae -> 2222
    expect(result[0].name).toBe('reg_sftp');
    expect(result[0].host).toBe('localhost');
    expect(result[0].username).toBe('user');
    expect(result[0].port).toBe(2222);
    expect(result[0].provider).toBe('sftp');

    expect(result[1].name).toBe('reg_s3');
    expect(result[1].endpoint).toBe('play.min.io');
    expect(result[1].provider).toBe('s3');
  });

  it('should parse tunnel configurations with gateway correctly', () => {
    const iniContent = `
[Sessions\\target]
HostName=target.com
UserName=app
FSProtocol=0
TunnelMethod=1
TunnelHostName=bastion.com
TunnelPortNumber=222
TunnelUserName=gateway_user
    `;
    const result = importFromWinSCP(iniContent);
    // Should produce two connections: the gateway (Infrastructure) and the target
    expect(result).toHaveLength(2);

    const gateway = result[0];
    const target = result[1];

    expect(gateway.name).toBe('Jump: gateway_user@bastion.com:222');
    expect(gateway.host).toBe('bastion.com');
    expect(gateway.port).toBe(222);
    expect(gateway.username).toBe('gateway_user');
    expect(gateway.isHidden).toBe(true);

    expect(target.name).toBe('target');
    expect(target.host).toBe('target.com');
    expect(target.username).toBe('app');
    expect(target.jumpHostName).toBe('Jump: gateway_user@bastion.com:222');
  });

  it('should handle registry dword: format in tunnel configurations', () => {
    const regContent = `
[Sessions\\target]
HostName=target.com
UserName=app
FSProtocol=dword:00000000
TunnelMethod=dword:00000001
TunnelHostName=bastion.com
TunnelPortNumber=dword:000000de
TunnelUserName=gateway_user
    `;
    const result = importFromWinSCP(regContent);
    expect(result).toHaveLength(2);

    const gateway = result[0];
    const target = result[1];

    // dword:000000de -> 222
    expect(gateway.name).toBe('Jump: gateway_user@bastion.com:222');
    expect(gateway.host).toBe('bastion.com');
    expect(gateway.port).toBe(222);
    expect(gateway.username).toBe('gateway_user');
    expect(gateway.isHidden).toBe(true);

    expect(target.name).toBe('target');
    expect(target.jumpHostName).toBe('Jump: gateway_user@bastion.com:222');
  });
});
