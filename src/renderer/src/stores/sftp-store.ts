import { create } from 'zustand';

interface SftpState {
  localPath: string;
  remotePath: string;
  localSelection: Set<string>;
  remoteSelection: Set<string>;
  showHiddenFiles: boolean;
  previewFile: { name: string; content: string; type: string } | null;
  sftpSessionId: string | null;

  toggleHiddenFiles: () => void;
  setLocalPath: (path: string) => void;
  setRemotePath: (path: string) => void;
  setLocalSelection: (selection: Set<string>) => void;
  setRemoteSelection: (selection: Set<string>) => void;
  toggleLocalSelection: (name: string) => void;
  toggleRemoteSelection: (name: string) => void;
  clearSelections: () => void;
  setPreviewFile: (file: { name: string; content: string; type: string } | null) => void;
  setSftpSessionId: (id: string | null) => void;
}

export const useSftpStore = create<SftpState>((set) => ({
  localPath: '',
  remotePath: '/',
  localSelection: new Set(),
  remoteSelection: new Set(),
  showHiddenFiles: false,
  previewFile: null,
  sftpSessionId: null,

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
  setSftpSessionId: (id) => set({ sftpSessionId: id }),
}));
