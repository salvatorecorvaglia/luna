import type { StorageProviderKind } from '@shared/types/storage-provider';
import type { StorageProvider } from './types';

/**
 * Maps a session id (uuid chosen by the renderer) to the provider that owns
 * it. Both SSH/SFTP sessions and S3 sessions register here so consumers like
 * the transfer queue can route an operation to the right backend without
 * branching on connection metadata at every call site.
 */
class StorageRegistry {
  private providers = new Map<string, StorageProvider>();

  register(sessionId: string, provider: StorageProvider): void {
    this.providers.set(sessionId, provider);
  }

  unregister(sessionId: string): void {
    this.providers.delete(sessionId);
  }

  get(sessionId: string): StorageProvider | undefined {
    return this.providers.get(sessionId);
  }

  /** Throwing variant — the IPC layer expects a session to be registered. */
  require(sessionId: string): StorageProvider {
    const p = this.providers.get(sessionId);
    if (!p) throw new Error(`No storage provider registered for session ${sessionId}`);
    return p;
  }

  kindOf(sessionId: string): StorageProviderKind | undefined {
    return this.providers.get(sessionId)?.kind;
  }
}

export const storageRegistry = new StorageRegistry();
