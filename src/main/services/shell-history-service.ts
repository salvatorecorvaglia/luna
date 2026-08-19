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

export class ShellHistoryService {
  private cachedHistory: string[] | null = null;

  /**
   * Reads and parses local shell history files (~/.zsh_history, ~/.bash_history).
   */
  async searchHistory(query: string, limit = 50): Promise<HistoryMatch[]> {
    if (!this.cachedHistory) {
      this.cachedHistory = await this.loadLocalHistory();
    }

    const q = query.trim().toLowerCase();
    const matches: HistoryMatch[] = [];
    const seen = new Set<string>();

    for (const line of this.cachedHistory) {
      if (!q || line.toLowerCase().includes(q)) {
        if (!seen.has(line)) {
          seen.add(line);
          matches.push({ command: line, source: 'zsh' });
          if (matches.length >= limit) break;
        }
      }
    }

    return matches;
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

  private async loadLocalHistory(): Promise<string[]> {
    const results: string[] = [];
    const home = homedir();

    const files = [join(home, '.zsh_history'), join(home, '.bash_history')];

    for (const file of files) {
      try {
        const raw = await this.readTail(file);
        const lines = raw.split('\n');
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          // Clean up zsh extended history timestamps: `: 1680000000:0;command`
          if (line.startsWith(':') && line.includes(';')) {
            line = line.substring(line.indexOf(';') + 1);
          }
          if (line.length > 2 && line.length < 500) {
            results.push(line);
          }
        }
      } catch (err) {
        log.debug(`[ShellHistory] Could not read ${file}:`, err);
      }
    }

    // Reverse so newest history comes first
    return results.reverse();
  }
}

export const shellHistoryService = new ShellHistoryService();
