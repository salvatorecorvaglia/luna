import type { ExportedConnection } from '@shared/types/connection';
import { importFromMobaXterm } from './mobaxterm';
import { importFromPuTTY } from './putty';
import { importFromWinSCP } from './winscp';

export function detectAndImport(content: string, fileName: string): ExportedConnection[] {
  const lowerName = fileName.toLowerCase();

  // Try to detect by content or extension
  if (
    content.includes('#109#') ||
    lowerName.endsWith('.mxtpro') ||
    lowerName.endsWith('.mxtsessions')
  ) {
    return importFromMobaXterm(content);
  }

  if (
    content.includes('SimonTatham\\PuTTY') ||
    (content.includes('HostName=') && content.includes('PortNumber='))
  ) {
    // This could be PuTTY or WinSCP, they share similar keys
    if (content.includes('FSProtocol=')) {
      return importFromWinSCP(content);
    }
    return importFromPuTTY(content);
  }

  // Fallback to WinSCP if it looks like an INI with Sessions
  if (content.includes('[Sessions\\')) {
    return importFromWinSCP(content);
  }

  return [];
}
