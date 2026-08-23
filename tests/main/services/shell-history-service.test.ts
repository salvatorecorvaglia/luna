import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fakeHome = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

describe('ShellHistoryService', () => {
  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'luna-history-'));
  });

  afterEach(async () => {
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('reads a small history file in full', async () => {
    await writeFile(join(fakeHome, '.zsh_history'), 'ls -la\ncd /tmp\ngit status\n', 'utf-8');
    const { ShellHistoryService } = await import(
      '../../../src/main/services/shell-history-service'
    );
    const service = new ShellHistoryService();

    const matches = await service.searchHistory('git');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.command).toBe('git status');
  });

  it('caps reads on a huge history file instead of loading it all into memory', async () => {
    // ~4-5 MiB of unique filler lines, well past the tail-read cap, so a line
    // near the start only exists outside the window that gets read.
    const totalLines = 200_000;
    const filler = `${Array.from({ length: totalLines }, (_, i) => `echo filler-line-${i}`).join('\n')}\n`;
    const recent = 'echo findme-recent-marker\n';
    await writeFile(join(fakeHome, '.zsh_history'), filler + recent, 'utf-8');

    const { ShellHistoryService } = await import(
      '../../../src/main/services/shell-history-service'
    );
    const service = new ShellHistoryService();

    // The very first line of the file sits far outside the last-N-bytes
    // window that a capped read covers — it must not be found.
    const earliest = await service.searchHistory('filler-line-0', 5);
    expect(earliest).toHaveLength(0);

    // A filler line near the very end of the file sits inside that window.
    const latestFiller = await service.searchHistory(`filler-line-${totalLines - 1}`, 5);
    expect(latestFiller).toHaveLength(1);

    // The genuinely most-recent command (appended after all the filler) is
    // exactly what search is meant to surface, and must still be found.
    const recentMatch = await service.searchHistory('findme-recent-marker', 5);
    expect(recentMatch).toHaveLength(1);
    expect(recentMatch[0]!.command).toBe('echo findme-recent-marker');
  });
});
