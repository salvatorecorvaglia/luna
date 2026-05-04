export type TransferType = 'upload' | 'download';
export type TransferStatus = 'queued' | 'active' | 'completed' | 'error' | 'cancelled';

export interface TransferItem {
  id: string;
  type: TransferType;
  localPath: string;
  remotePath: string;
  fileName: string;
  size: number;
  transferred: number;
  status: TransferStatus;
  error?: string;
  bytesPerSec: number;
  sessionId: string;
}

export interface TransferProgressEvent {
  transferId: string;
  transferred: number;
  total: number;
  bytesPerSec: number;
}

export interface TransferCompleteEvent {
  transferId: string;
}

export interface TransferErrorEvent {
  transferId: string;
  error: string;
}
