import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionAuditService } from '../../../src/main/services/session-audit-service';

describe('SessionAuditService.exportAuditLog', () => {
  const written: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(written.splice(0).map((p) => rm(p, { force: true })));
  });

  it('escapes an HTML-unsafe session title, not just the buffer text', async () => {
    const destinationPath = join(tmpdir(), `luna-audit-title-${Date.now()}.html`);
    written.push(destinationPath);

    await sessionAuditService.exportAuditLog({
      sessionId: 'session-1',
      sessionTitle: '<script>alert(1)</script>',
      bufferText: 'hello & <world>',
      format: 'html',
      destinationPath,
    });

    const content = await readFile(destinationPath, 'utf-8');
    expect(content).not.toContain('<script>alert(1)</script>');
    expect(content).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // Buffer escaping (already correct before this fix) must still hold.
    expect(content).toContain('hello &amp; &lt;world&gt;');
  });
});
