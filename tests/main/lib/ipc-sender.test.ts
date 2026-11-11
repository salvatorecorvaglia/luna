import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/main/lib/ipc-sender');

import { assertTrustedIpcSender, setTrustedIpcSender } from '../../../src/main/lib/ipc-sender';

const entry = resolve('out/renderer/index.html');
function document(url = pathToFileURL(entry).href) {
  const frame = { url };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  return { contents, event: { sender: contents, senderFrame: frame } };
}
function assert(event: unknown) {
  assertTrustedIpcSender(event as Electron.IpcMainInvokeEvent);
}
afterEach(() => setTrustedIpcSender(null));

describe('IPC document ownership', () => {
  it('fails closed before a window is registered and when frame information is missing', () => {
    expect(() => assert({})).toThrow(/sender/);
    const { contents } = document();
    setTrustedIpcSender(contents as unknown as WebContents, entry);
    expect(() => assert({ sender: contents })).toThrow(/sender/);
  });
  it('allows only the registered window main frame at the bundled entry', () => {
    const { contents, event } = document();
    setTrustedIpcSender(contents as unknown as WebContents, entry);
    expect(() => assert(event)).not.toThrow();
    expect(() => assert(document().event)).toThrow(/sender/);
    expect(() =>
      assert({ sender: contents, senderFrame: { url: contents.mainFrame.url } }),
    ).toThrow(/sender/);
    contents.mainFrame.url = pathToFileURL(resolve('other.html')).href;
    expect(() => assert(event)).toThrow(/sender/);
  });
  it('rejects destroyed windows and unregisters on close', () => {
    const { contents, event } = document();
    setTrustedIpcSender(contents as unknown as WebContents, entry);
    contents.isDestroyed = () => true;
    expect(() => assert(event)).toThrow();
    setTrustedIpcSender(null);
    expect(() => assert(event)).toThrow();
  });
  it('allows the explicit development origin, but not another port or host', () => {
    const { contents, event } = document('http://localhost:5173/');
    setTrustedIpcSender(contents as unknown as WebContents, entry, 'http://localhost:5173');
    expect(() => assert(event)).not.toThrow();
    contents.mainFrame.url = 'http://localhost:5174/';
    expect(() => assert(event)).toThrow();
    contents.mainFrame.url = 'https://example.com/';
    expect(() => assert(event)).toThrow();
  });
});
