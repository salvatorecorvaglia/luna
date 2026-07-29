export interface AuditExportOptions {
  sessionId: string;
  sessionTitle: string;
  bufferText: string;
  format: 'json' | 'html' | 'txt';
  destinationPath: string;
}
