import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HistoryMatch } from '@shared/types/shell-history';
import log from '../lib/logger';

export type { HistoryMatch };

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

  private async loadLocalHistory(): Promise<string[]> {
    const results: string[] = [];
    const home = homedir();

    const files = [join(home, '.zsh_history'), join(home, '.bash_history')];

    for (const file of files) {
      try {
        const raw = await readFile(file, 'utf-8');
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
