import { registerConnectionHandlers } from './connection.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerCredentialHandlers } from './credentials.ipc';
import { registerShellHandlers } from './shell.ipc';
import { registerSshHandlers } from './ssh.ipc';
import { registerSftpHandlers } from './sftp.ipc';
import { registerStorageHandlers } from './storage.ipc';
import { registerS3Handlers } from './s3.ipc';
import { registerAppHandlers } from './app.ipc';
import { registerLocalTerminalHandlers } from './local-terminal.ipc';
import { registerLogHandlers } from './log.ipc';

export function registerAllHandlers(): void {
  registerConnectionHandlers();
  registerSettingsHandlers();
  registerCredentialHandlers();
  registerShellHandlers();
  registerSshHandlers();
  registerSftpHandlers();
  registerStorageHandlers();
  registerS3Handlers();
  registerAppHandlers();
  registerLocalTerminalHandlers();
  registerLogHandlers();
}
