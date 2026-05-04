export interface SftpEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: string;
  owner: number;
  group: number;
}

export interface SftpListParams {
  sessionId: string;
  path: string;
}

export interface SftpStatParams {
  sessionId: string;
  path: string;
}

export interface SftpStatResult {
  size: number;
  mode: number;
  modifiedAt: number;
  uid: number;
  gid: number;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: string;
}

export interface SftpMkdirParams {
  sessionId: string;
  path: string;
}

export interface SftpRenameParams {
  sessionId: string;
  oldPath: string;
  newPath: string;
}

export interface SftpDeleteParams {
  sessionId: string;
  path: string;
  isDirectory: boolean;
}

export interface SftpReadFileParams {
  sessionId: string;
  path: string;
  maxSize?: number;
}

export interface SftpTransferParams {
  sessionId: string;
  localPath: string;
  remotePath: string;
}

export interface LocalFileEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSymlink: boolean;
}

/** Unified file entry type for use in the renderer file browser UI. */
export interface FileEntry {
  name: string;
  path: string;
  size: number;
  modifiedAt: number;
  isDirectory: boolean;
  isSymlink?: boolean;
  permissions?: string;
}
