// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { openTerminalLink } from '../../../src/renderer/src/lib/terminal-links';
import { installFakeApi } from '../../../src/test/fake-api';

describe('openTerminalLink', () => {
  let api: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    api = installFakeApi();
  });

  it('ignores a plain click — that is text selection, and output is untrusted', () => {
    openTerminalLink(new MouseEvent('click'), 'https://example.com');
    expect(api.app.openExternal).not.toHaveBeenCalled();
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('opens on %s-click', (_name, init) => {
    openTerminalLink(new MouseEvent('click', init), 'https://example.com');
    expect(api.app.openExternal).toHaveBeenCalledWith('https://example.com');
  });
});
