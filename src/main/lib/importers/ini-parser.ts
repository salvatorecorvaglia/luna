/**
 * A simple, zero-dependency INI parser for configuration files.
 * Supports sections, key-value pairs, and comments starting with ; or #.
 */
export function parseIni(content: string): Record<string, Record<string, string>> {
  const lines = content.split(/\r?\n/);
  const result: Record<string, Record<string, string>> = {};
  let currentSection = 'default';

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    const firstEqual = line.indexOf('=');
    if (firstEqual > 0) {
      const key = line.substring(0, firstEqual).trim();
      const value = line.substring(firstEqual + 1).trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      result[currentSection][key] = value;
    }
  }

  return result;
}
