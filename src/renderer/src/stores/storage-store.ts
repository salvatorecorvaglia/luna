import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StorageProviderKind } from '@shared/types/storage-provider';

/** Tracks a non-SSH storage session (e.g. an open S3 client). SFTP sessions
 * piggyback on the terminal session map, but S3 has no terminal so its
 * "open connections" live here. */
export interface StorageSession {
  id: string;
  connectionId: string;
  connectionName: string;
  provider: StorageProviderKind;
  status: 'connecting' | 'connected' | 'error';
  /** Initial remote path — for S3 with a default bucket, this is `/<bucket>`. */
  initialPath: string;
}

interface StorageState {
  localPath: string;
  remotePath: string;
  localSelection: Set<string>;
  remoteSelection: Set<string>;
  showHiddenFiles: boolean;
  previewFile: { name: string; content: string; type: string } | null;
  /** Current active session id (can be SFTP/SSH session id or S3 session id). */
  activeSessionId: string | null;
  /** Active non-SSH storage sessions (currently: S3). Keyed by session id. */
  storageSessions: Map<string, StorageSession>;

  toggleHiddenFiles: () => void;
  setLocalPath: (path: string) => void;
  setRemotePath: (path: string) => void;
  setLocalSelection: (selection: Set<string>) => void;
  setRemoteSelection: (selection: Set<string>) => void;
  toggleLocalSelection: (name: string) => void;
  toggleRemoteSelection: (name: string) => void;
  clearSelections: () => void;
  setPreviewFile: (file: { name: string; content: string; type: string } | null) => void;
  setActiveSessionId: (id: string | null) => void;
  addStorageSession: (session: StorageSession) => void;
  updateStorageSessionStatus: (id: string, status: StorageSession['status']) => void;
  removeStorageSession: (id: string) => void;
}

export const useStorageStore = create<StorageState>()(
  persist(
    (set) => ({
      localPath: '',
      remotePath: '/',
      localSelection: new Set(),
      remoteSelection: new Set(),
      showHiddenFiles: false,
      previewFile: null,
      activeSessionId: null,
      storageSessions: new Map(),

      toggleHiddenFiles: () => set((s) => ({ showHiddenFiles: !s.showHiddenFiles })),
      setLocalPath: (path) => set({ localPath: path, localSelection: new Set() }),
      setRemotePath: (path) => set({ remotePath: path, remoteSelection: new Set() }),
      setLocalSelection: (selection) => set({ localSelection: selection }),
      setRemoteSelection: (selection) => set({ remoteSelection: selection }),
      toggleLocalSelection: (name) =>
        set((s) => {
          const next = new Set(s.localSelection);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return { localSelection: next };
        }),
      toggleRemoteSelection: (name) =>
        set((s) => {
          const next = new Set(s.remoteSelection);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return { remoteSelection: next };
        }),
      clearSelections: () => set({ localSelection: new Set(), remoteSelection: new Set() }),
      setPreviewFile: (file) => set({ previewFile: file }),
      setActiveSessionId: (id) => set({ activeSessionId: id }),
      addStorageSession: (session) =>
        set((s) => {
          // Skip duplicates: a retry/reconnect for the same session id must not
          // grow the map. Status updates go through updateStorageSessionStatus.
          if (s.storageSessions.has(session.id)) return s;
          const next = new Map(s.storageSessions);
          next.set(session.id, session);
          return { storageSessions: next };
        }),
      updateStorageSessionStatus: (id, status) =>
        set((s) => {
          const existing = s.storageSessions.get(id);
          if (!existing) return s;
          const next = new Map(s.storageSessions);
          next.set(id, { ...existing, status });
          return { storageSessions: next };
        }),
      removeStorageSession: (id) =>
        set((s) => {
          if (!s.storageSessions.has(id)) return s;
          const next = new Map(s.storageSessions);
          next.delete(id);
          return { storageSessions: next };
        }),
    }),
    {
      name: 'lunar-storage-store',
      partialize: (state) => ({
        localPath: state.localPath,
        remotePath: state.remotePath,
        activeSessionId: state.activeSessionId,
        showHiddenFiles: state.showHiddenFiles,
      }),
    },
  ),
);
