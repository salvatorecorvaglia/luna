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
