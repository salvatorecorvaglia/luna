import { describe, expect, it } from 'vitest';
import { detectAndImport } from '../../../../src/main/services/importers';

describe('detectAndImport', () => {
  it('detects a WinSCP INI by content when called with (content, fileName)', () => {
    const iniContent = `
[Sessions\\test_session]
HostName=192.168.1.100
UserName=admin
PortNumber=22
FSProtocol=0
    `;
    const result = detectAndImport(iniContent, '/Users/alice/Downloads/sessions.ini');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('test_session');
    expect(result[0]!.host).toBe('192.168.1.100');
  });

  it('detects a MobaXterm export by file extension when content has no distinguishing marker', () => {
    // MobaXterm .mxtsessions content is detected primarily by extension, so this
    // exercises the (content, fileName) argument order directly: swapping the
    // arguments would check the extension against the content string instead.
    const sshLineParts: string[] = new Array(21).fill('');
    sshLineParts[0] = '#109#0';
    sshLineParts[1] = 'my-host';
    sshLineParts[2] = '22';
    sshLineParts[3] = 'me';
    const content = ['[Bookmarks]', 'SubRep=Servers', `web1=${sshLineParts.join('%')}`].join('\n');
    const result = detectAndImport(content, '/Users/alice/Downloads/sessions.mxtsessions');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns an empty array for unrecognised content', () => {
    const result = detectAndImport('not a known connection format', '/tmp/notes.txt');
    expect(result).toEqual([]);
  });

  it('returns an empty array if the arguments are passed in the wrong order (regression guard)', () => {
    // Documents the exact bug this test suite was added to catch: passing the
    // file path where content is expected (and vice versa) makes every
    // heuristic fail, so import silently returns nothing.
    const iniContent = `
[Sessions\\test_session]
HostName=192.168.1.100
UserName=admin
PortNumber=22
FSProtocol=0
    `;
    const result = detectAndImport('/Users/alice/Downloads/sessions.ini', iniContent);
    expect(result).toEqual([]);
  });
});
