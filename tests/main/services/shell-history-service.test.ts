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

  // Regression: `source` was hardcoded to 'zsh' for every match even though
  // loadLocalHistory reads both files, so every bash command was mislabelled.
  // `HistoryMatch.source` exists precisely to tell these apart.
  it('labels each command with the shell whose history file it came from', async () => {
    await writeFile(join(fakeHome, '.zsh_history'), 'echo from-zsh\n', 'utf-8');
    await writeFile(join(fakeHome, '.bash_history'), 'echo from-bash\n', 'utf-8');
    const { ShellHistoryService } = await import(
      '../../../src/main/services/shell-history-service'
    );
    const service = new ShellHistoryService();

    const zsh = await service.searchHistory('from-zsh');
    expect(zsh).toHaveLength(1);
    expect(zsh[0]!.source).toBe('zsh');

    const bash = await service.searchHistory('from-bash');
    expect(bash).toHaveLength(1);
    expect(bash[0]!.source).toBe('bash');
  });

  // Regression: results were built by concatenating both files and reversing
  // the whole array once. Because bash was appended second, that surfaced every
  // bash entry before any zsh entry — and the `limit` break then truncated the
  // zsh half away entirely. On macOS (zsh by default) that is the user's actual
  // recent history disappearing behind stale bash lines.
  it('does not let one shell starve the other out of a limited result set', async () => {
    const many = `${Array.from({ length: 100 }, (_, i) => `echo shared-token-bash-${i}`).join('\n')}\n`;
    await writeFile(join(fakeHome, '.bash_history'), many, 'utf-8');
    await writeFile(join(fakeHome, '.zsh_history'), 'echo shared-token-zsh-only\n', 'utf-8');

    const { ShellHistoryService } = await import(
      '../../../src/main/services/shell-history-service'
    );
    const service = new ShellHistoryService();

    const matches = await service.searchHistory('shared-token', 10);
    expect(matches).toHaveLength(10);
    expect(matches.some((m) => m.source === 'zsh')).toBe(true);
  });

  // Regression: the cache was populated once per process and never invalidated,
  // so commands run during the session never appeared until an app restart.
  it('picks up newly written history after the cache is invalidated', async () => {
    await writeFile(join(fakeHome, '.zsh_history'), 'echo first\n', 'utf-8');
    const { ShellHistoryService } = await import(
      '../../../src/main/services/shell-history-service'
    );
    const service = new ShellHistoryService();

    expect(await service.searchHistory('second')).toHaveLength(0);

    await writeFile(join(fakeHome, '.zsh_history'), 'echo first\necho second\n', 'utf-8');
    service.invalidateCache();

    const after = await service.searchHistory('second');
    expect(after).toHaveLength(1);
    expect(after[0]!.command).toBe('echo second');
  });
});
