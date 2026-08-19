import { IPC } from '@shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

// Allocated inside the factory so vi.mock's top-level hoist doesn't capture
// an uninitialised reference; read back through the intercepted import below.
vi.mock('../../../src/main/services/connection-service', () => ({
  connectionService: {
    listConnections: vi.fn(),
    getConnection: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    renameFolder: vi.fn(),
    deleteConnection: vi.fn(),
    deleteAllConnections: vi.fn(),
    reorderConnections: vi.fn(),
    exportConnections: vi.fn(),
    importConnections: vi.fn(),
    importFromFile: vi.fn(),
    importFromSshConfig: vi.fn(),
  },
}));

import { registerConnectionHandlers } from '../../../src/main/ipc/connection.ipc';
import { connectionService } from '../../../src/main/services/connection-service';

const connectionServiceMock = connectionService as unknown as Record<
  string,
  ReturnType<typeof vi.fn>
>;

beforeEach(() => {
  handlers.clear();
  for (const fn of Object.values(connectionServiceMock)) {
    fn.mockReset();
  }
  registerConnectionHandlers();
});

/**
 * Each channel is a thin one-line delegation to connectionService — the
 * class of bug this file exists to catch is a channel wired to the *wrong*
 * service method (e.g. CONNECTION_IMPORT_FROM_FILE accidentally calling
 * importFromSshConfig, or vice versa — exactly what happened with
 * detectAndImport's swapped arguments before it was fixed). Asserting each
 * channel calls its own distinctly-mocked method, and no other, catches
 * that wiring mistake even though every method here returns undefined.
 */
describe('connection IPC — channel wiring', () => {
  it('CONNECTION_LIST calls listConnections', async () => {
    connectionServiceMock.listConnections.mockReturnValue(['a']);
    await expect(handlers.get(IPC.CONNECTION_LIST)!({})).resolves.toEqual(['a']);
    expect(connectionServiceMock.listConnections).toHaveBeenCalledTimes(1);
  });

  it('CONNECTION_GET calls getConnection with the id', async () => {
    connectionServiceMock.getConnection.mockReturnValue({ id: 'c1' });
    await expect(handlers.get(IPC.CONNECTION_GET)!({}, 'c1')).resolves.toEqual({ id: 'c1' });
    expect(connectionServiceMock.getConnection).toHaveBeenCalledWith('c1');
  });

  it('CONNECTION_CREATE calls createConnection with the input', async () => {
    const input = { name: 'new', provider: 'sftp' };
    await handlers.get(IPC.CONNECTION_CREATE)!({}, input);
    expect(connectionServiceMock.createConnection).toHaveBeenCalledWith(input);
  });

  it('CONNECTION_UPDATE calls updateConnection with the input', async () => {
    const input = { id: 'c1', name: 'renamed' };
    await handlers.get(IPC.CONNECTION_UPDATE)!({}, input);
    expect(connectionServiceMock.updateConnection).toHaveBeenCalledWith(input);
  });

  it('CONNECTION_RENAME_FOLDER calls renameFolder with the params', async () => {
    const params = { oldName: 'a', newName: 'b', provider: 'sftp' as const };
    await handlers.get(IPC.CONNECTION_RENAME_FOLDER)!({}, params);
    expect(connectionServiceMock.renameFolder).toHaveBeenCalledWith(params);
  });

  it('CONNECTION_DELETE calls deleteConnection with the id', async () => {
    await handlers.get(IPC.CONNECTION_DELETE)!({}, 'c1');
    expect(connectionServiceMock.deleteConnection).toHaveBeenCalledWith('c1');
    expect(connectionServiceMock.deleteAllConnections).not.toHaveBeenCalled();
  });

  it('CONNECTION_DELETE_ALL calls deleteAllConnections, not deleteConnection', async () => {
    await handlers.get(IPC.CONNECTION_DELETE_ALL)!({});
    expect(connectionServiceMock.deleteAllConnections).toHaveBeenCalledTimes(1);
    expect(connectionServiceMock.deleteConnection).not.toHaveBeenCalled();
  });

  it('CONNECTION_REORDER calls reorderConnections with the id list', async () => {
    await handlers.get(IPC.CONNECTION_REORDER)!({}, ['b', 'a']);
    expect(connectionServiceMock.reorderConnections).toHaveBeenCalledWith(['b', 'a']);
  });

  it('CONNECTION_EXPORT calls exportConnections, not importConnections', async () => {
    connectionServiceMock.exportConnections.mockReturnValue([{ name: 'x' }]);
    await expect(handlers.get(IPC.CONNECTION_EXPORT)!({})).resolves.toEqual([{ name: 'x' }]);
    expect(connectionServiceMock.exportConnections).toHaveBeenCalledTimes(1);
    expect(connectionServiceMock.importConnections).not.toHaveBeenCalled();
  });

  it('CONNECTION_IMPORT calls importConnections with the connection list', async () => {
    const list = [{ name: 'x' }];
    await handlers.get(IPC.CONNECTION_IMPORT)!({}, list);
    expect(connectionServiceMock.importConnections).toHaveBeenCalledWith(list);
  });

  // Regression coverage for the exact defect class this suite was added for:
  // CONNECTION_IMPORT_FROM_FILE and CONNECTION_IMPORT_SSH_CONFIG must each
  // reach their own distinct service method, and pass no arguments through
  // (both service methods own their own dialog/file-path resolution).
  it('CONNECTION_IMPORT_FROM_FILE calls importFromFile only', async () => {
    connectionServiceMock.importFromFile.mockResolvedValue({ imported: 2, skipped: [] });
    await expect(handlers.get(IPC.CONNECTION_IMPORT_FROM_FILE)!({})).resolves.toEqual({
      imported: 2,
      skipped: [],
    });
    expect(connectionServiceMock.importFromFile).toHaveBeenCalledTimes(1);
    expect(connectionServiceMock.importFromFile).toHaveBeenCalledWith();
    expect(connectionServiceMock.importFromSshConfig).not.toHaveBeenCalled();
  });

  it('CONNECTION_IMPORT_SSH_CONFIG calls importFromSshConfig only', async () => {
    connectionServiceMock.importFromSshConfig.mockResolvedValue({ imported: 1, skipped: [] });
    await expect(handlers.get(IPC.CONNECTION_IMPORT_SSH_CONFIG)!({})).resolves.toEqual({
      imported: 1,
      skipped: [],
    });
    expect(connectionServiceMock.importFromSshConfig).toHaveBeenCalledTimes(1);
    expect(connectionServiceMock.importFromSshConfig).toHaveBeenCalledWith();
    expect(connectionServiceMock.importFromFile).not.toHaveBeenCalled();
  });
});
