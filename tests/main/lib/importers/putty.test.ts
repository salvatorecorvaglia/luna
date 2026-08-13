import { describe, expect, it } from 'vitest';
import { importFromPuTTY } from '../../../../src/main/lib/importers/putty';

describe('PuTTY Importer', () => {
  it('should parse standard PuTTY sessions correctly', () => {
    const registryContent = `
[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\test_session]
HostName="192.168.1.100"
UserName="admin"
PortNumber=dword:00000016
PublicKeyFile="~/keys/id_rsa"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\second_session]
HostName="example.com"
UserName="root"
PortNumber=2222
    `;
    const result = importFromPuTTY(registryContent);
    expect(result).toHaveLength(2);

    expect(result[0].name).toBe('test_session');
    expect(result[0].host).toBe('192.168.1.100');
    expect(result[0].username).toBe('admin');
    expect(result[0].port).toBe(22);
    expect(result[0].privateKeyPath).toBe('~/keys/id_rsa');
    expect(result[0].authType).toBe('key');

    expect(result[1].name).toBe('second_session');
    expect(result[1].host).toBe('example.com');
    expect(result[1].username).toBe('root');
    expect(result[1].port).toBe(2222);
    expect(result[1].privateKeyPath).toBeUndefined();
    expect(result[1].authType).toBe('password');
  });

  it('should decode URL-encoded session names', () => {
    const registryContent = `
[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\my%20ssh%20session]
HostName="localhost"
    `;
    const result = importFromPuTTY(registryContent);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('my ssh session');
  });

  it('should not crash and keep original name on malformed percent sequence', () => {
    const registryContent = `
[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\malformed%2Gsession]
HostName="localhost"

[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\good_session]
HostName="127.0.0.1"
    `;
    const result = importFromPuTTY(registryContent);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('malformed%2Gsession');
    expect(result[1].name).toBe('good_session');
  });
});
