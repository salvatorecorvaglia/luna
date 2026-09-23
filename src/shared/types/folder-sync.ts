export interface FolderDiffItem {
  relativePath: string;
  localSize?: number;
  localMtime?: number;
  remoteSize?: number;
  remoteMtime?: number;
  status: 'only-local' | 'only-remote' | 'modified' | 'identical';
  recommendedAction: 'upload' | 'download' | 'skip' | 'conflict';
}

export interface FolderDiffResult {
  items: FolderDiffItem[];
  onlyLocalCount: number;
  onlyRemoteCount: number;
  modifiedCount: number;
  identicalCount: number;
}
