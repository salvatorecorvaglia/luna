import { writeFile } from 'node:fs/promises';
import type { AuditExportOptions } from '@shared/types/session-audit';

export type { AuditExportOptions };

export class SessionAuditService {
  /**
   * Formats terminal buffer output into structured JSON, formatted HTML report, or TXT file.
   */
  async exportAuditLog(options: AuditExportOptions): Promise<{ success: boolean; path: string }> {
    const { sessionTitle, bufferText, format, destinationPath } = options;
    const nowStr = new Date().toISOString();

    let outputContent = '';

    if (format === 'json') {
      const data = {
        title: sessionTitle,
        exportedAt: nowStr,
        lineCount: bufferText.split('\n').length,
        lines: bufferText.split('\n'),
      };
      outputContent = JSON.stringify(data, null, 2);
    } else if (format === 'html') {
      const escapeHtml = (s: string): string =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeTitle = escapeHtml(sessionTitle);
      const sanitizedLines = escapeHtml(bufferText)
        .split('\n')
        .map((l) => `<div className="line">${l || '&nbsp;'}</div>`)
        .join('\n');

      outputContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Audit Log - ${safeTitle}</title>
  <style>
    body { background-color: #0f172a; color: #f8fafc; font-family: monospace; font-size: 12px; padding: 24px; }
    h1 { font-size: 16px; margin-bottom: 4px; border-b: 1px solid #334155; padding-bottom: 8px; }
    .meta { font-size: 11px; color: #94a3b8; margin-bottom: 16px; }
    .log-box { background-color: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; overflow-x: auto; white-space: pre; }
    .line { line-height: 1.5; }
  </style>
</head>
<body>
  <h1>Terminal Audit Trail: ${safeTitle}</h1>
  <div className="meta">Exported At: ${nowStr}</div>
  <div className="log-box">
${sanitizedLines}
  </div>
</body>
</html>`;
    } else {
      // Plain text
      outputContent = `==================================================\nLUNA TERMINAL AUDIT TRAIL: ${sessionTitle}\nEXPORTED AT: ${nowStr}\n==================================================\n\n${bufferText}`;
    }

    await writeFile(destinationPath, outputContent, 'utf-8');
    return { success: true, path: destinationPath };
  }
}

export const sessionAuditService = new SessionAuditService();
