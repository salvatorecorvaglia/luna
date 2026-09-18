import { open, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HistoryMatch } from '@shared/types/shell-history';
import log from '../lib/logger';

export type { HistoryMatch };

/**
 * Cap on how much of a single history file is read and parsed. Without it, a
 * user with years of accumulated `.zsh_history`/`.bash_history` (tens of MB)
 * triggering command-palette search reads the whole file into memory and
 * runs a synchronous split+parse loop on the Electron main process, stalling
 * every other IPC call for the duration. Recent history — which is what
 * search actually wants — lives at the end of the file, so reading only the
 * tail both bounds the cost and keeps the useful part.
 */
const MAX_HISTORY_BYTES_PER_FILE = 2 * 1024 * 1024;

/**
 * How long a parsed history snapshot stays valid.
 *
 * The cache used to be populated once and never invalidated, so commands run
 * during the session never showed up in palette search until the app was
 * restarted. A short TTL keeps the expensive tail-read off the hot path while
 * still picking up new history within a minute.
 */
const HISTORY_CACHE_TTL_MS = 60_000;

/** One parsed history line, tagged with the file it came from. */
interface HistoryEntry {
  command: string;
  source: 'zsh' | 'bash';
}

export class ShellHistoryService {
  private cachedHistory: HistoryEntry[] | null = null;
  private cachedAt = 0;

  /**
   * Reads and parses local shell history files (~/.zsh_history, ~/.bash_history).
   */
  async searchHistory(query: string, limit = 50): Promise<HistoryMatch[]> {
    if (!this.cachedHistory || Date.now() - this.cachedAt >= HISTORY_CACHE_TTL_MS) {
      this.cachedHistory = await this.loadLocalHistory();
      this.cachedAt = Date.now();
    }

    const q = query.trim().toLowerCase();
    const matches: HistoryMatch[] = [];
    const seen = new Set<string>();

    for (const entry of this.cachedHistory) {
      if (!q || entry.command.toLowerCase().includes(q)) {
        if (!seen.has(entry.command)) {
          seen.add(entry.command);
          // `source` used to be hardcoded to 'zsh' for every match even though
          // both files are read, so every bash command was mislabelled in the
          // UI — which is the one thing this field exists to tell you.
          matches.push({ command: entry.command, source: entry.source });
          if (matches.length >= limit) break;
        }
      }
    }

    return matches;
  }

  /** Drop the cached snapshot so the next search re-reads from disk. */
  invalidateCache(): void {
    this.cachedHistory = null;
  }

  /** Reads at most the last MAX_HISTORY_BYTES_PER_FILE bytes of `file`. */
  private async readTail(file: string): Promise<string> {
    const stats = await stat(file);
    if (stats.size <= MAX_HISTORY_BYTES_PER_FILE) {
      return readFile(file, 'utf-8');
    }
    const handle = await open(file, 'r');
    try {
      const start = stats.size - MAX_HISTORY_BYTES_PER_FILE;
      const buffer = Buffer.alloc(MAX_HISTORY_BYTES_PER_FILE);
      await handle.read(buffer, 0, MAX_HISTORY_BYTES_PER_FILE, start);
      const text = buffer.toString('utf-8');
      // The read starts mid-file, so the first line is almost certainly a
      // partial fragment — drop it rather than surface a garbled entry.
      return text.slice(text.indexOf('\n') + 1);
    } finally {
      await handle.close();
    }
  }

  private async loadLocalHistory(): Promise<HistoryEntry[]> {
    const home = homedir();

    const files: { path: string; source: 'zsh' | 'bash' }[] = [
      { path: join(home, '.zsh_history'), source: 'zsh' },
      { path: join(home, '.bash_history'), source: 'bash' },
    ];

    // Collect per file, newest-first *within* each file.
    //
    // The previous code concatenated both files and reversed the whole array
    // once at the end. Because bash was appended second, that put every bash
    // entry ahead of every zsh entry — so on macOS (zsh by default) a user's
    // genuinely recent commands sat behind a wall of stale bash history, and
    // searchHistory's `matches.length >= limit` break frequently truncated
    // them away entirely.
    const perFile: HistoryEntry[][] = [];

    for (const { path, source } of files) {
      const entries: HistoryEntry[] = [];
      try {
        const raw = await this.readTail(path);
        for (let line of raw.split('\n')) {
          line = line.trim();
          if (!line) continue;
          // Clean up zsh extended history timestamps: `: 1680000000:0;command`
          if (line.startsWith(':') && line.includes(';')) {
            line = line.substring(line.indexOf(';') + 1);
          }
          if (line.length > 2 && line.length < 500) {
            entries.push({ command: line, source });
          }
        }
      } catch (err) {
        log.debug(`[ShellHistory] Could not read ${path}:`, err);
      }
      // Newest first within this file.
      entries.reverse();
      perFile.push(entries);
    }

    // Interleave the files so neither shell can starve the other out of the
    // result limit. Both are "recent" to the user; which file a command landed
    // in is an implementation detail of their login shell, not a ranking.
    const merged: HistoryEntry[] = [];
    const longest = Math.max(0, ...perFile.map((e) => e.length));
    for (let i = 0; i < longest; i++) {
      for (const entries of perFile) {
        const entry = entries[i];
        if (entry) merged.push(entry);
      }
    }
    return merged;
  }
}

export const shellHistoryService = new ShellHistoryService();
