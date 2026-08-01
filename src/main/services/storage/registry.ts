import { ErrorCode, LunaError } from '@shared/errors';
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
  /**
   * Sessions that are being torn down. An IPC call landing between the
   * disconnect signal and the providers-map delete would otherwise retrieve
   * a provider whose underlying transport is closing — guaranteeing a
   * confusing downstream failure. `require()` checks this set and surfaces
   * a clear "session is closing" error instead.
   */
  private closing = new Set<string>();

  register(sessionId: string, provider: StorageProvider): void {
    // Re-register clears any stale "closing" marker from a prior lifecycle
    // so a reconnect using the same sessionId isn't permanently poisoned.
    this.closing.delete(sessionId);
    this.providers.set(sessionId, provider);
  }

  /**
   * Mark a session as being torn down. Must be called *before* the underlying
   * transport begins closing so concurrent require() callers see the closing
   * state and bail out rather than receiving a still-registered provider
   * pointing at a half-dead session.
   */
  markClosing(sessionId: string): void {
    if (this.providers.has(sessionId)) this.closing.add(sessionId);
  }

  unregister(sessionId: string): void {
    this.providers.delete(sessionId);
    this.closing.delete(sessionId);
  }

  get(sessionId: string): StorageProvider | undefined {
    return this.providers.get(sessionId);
  }

  /** Throwing variant — the IPC layer expects a session to be registered. */
  require(sessionId: string): StorageProvider {
    if (this.closing.has(sessionId)) {
      throw new LunaError(`Storage session ${sessionId} is closing`, ErrorCode.NOT_FOUND, {
        sessionId,
        reason: 'closing',
      });
    }
    const p = this.providers.get(sessionId);
    if (!p) {
      throw new LunaError(
        `No storage provider registered for session ${sessionId}`,
        ErrorCode.NOT_FOUND,
        { sessionId, reason: 'unregistered' },
      );
    }
    return p;
  }

  kindOf(sessionId: string): StorageProviderKind | undefined {
    return this.providers.get(sessionId)?.kind;
  }
}

export const storageRegistry = new StorageRegistry();
