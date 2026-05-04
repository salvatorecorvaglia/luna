import { registerDbHandlers } from './db.ipc';
import { registerCredentialHandlers } from './credentials.ipc';
import { registerShellHandlers } from './shell.ipc';
import { registerSshHandlers } from './ssh.ipc';
import { registerSftpHandlers } from './sftp.ipc';
import { registerAppHandlers } from './app.ipc';

export function registerAllHandlers(): void {
  registerDbHandlers();
  registerCredentialHandlers();
  registerShellHandlers();
  registerSshHandlers();
  registerSftpHandlers();
  registerAppHandlers();
}
