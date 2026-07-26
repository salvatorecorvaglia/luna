import { IPC } from '@shared/constants';
import type {
  CreateConnectionInput,
  ExportedConnection,
  UpdateConnectionInput,
} from '@shared/types/connection';
import { registerHandler } from '../lib/ipc-handler';
import { connectionService } from '../services/connection-service';

export function registerConnectionHandlers(): void {
  registerHandler(IPC.CONNECTION_LIST, () => {
    return connectionService.listConnections();
  });

  registerHandler(IPC.CONNECTION_GET, (_event, id: string) => {
    return connectionService.getConnection(id);
  });

  registerHandler(IPC.CONNECTION_CREATE, (_event, input: CreateConnectionInput) => {
    return connectionService.createConnection(input);
  });

  registerHandler(IPC.CONNECTION_UPDATE, (_event, input: UpdateConnectionInput) => {
    return connectionService.updateConnection(input);
  });

  registerHandler(
    IPC.CONNECTION_RENAME_FOLDER,
    (_event, params: { oldName: string; newName: string; provider: 'sftp' | 's3' }) => {
      connectionService.renameFolder(params);
    },
  );

  registerHandler(IPC.CONNECTION_DELETE, (_event, id: string) => {
    connectionService.deleteConnection(id);
  });

  registerHandler(IPC.CONNECTION_DELETE_ALL, () => {
    connectionService.deleteAllConnections();
  });

  registerHandler(IPC.CONNECTION_REORDER, (_event, ids: string[]) => {
    connectionService.reorderConnections(ids);
  });

  registerHandler(IPC.CONNECTION_EXPORT, () => {
    return connectionService.exportConnections();
  });

  registerHandler(IPC.CONNECTION_IMPORT, (_event, connections: ExportedConnection[]) => {
    return connectionService.importConnections(connections);
  });

  registerHandler(IPC.CONNECTION_IMPORT_FROM_FILE, () => {
    return connectionService.importFromFile();
  });

  registerHandler(IPC.CONNECTION_IMPORT_SSH_CONFIG, () => {
    return connectionService.importFromSshConfig();
  });
}
