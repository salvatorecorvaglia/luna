/**
 * A simple, zero-dependency INI parser for configuration files.
 * Supports sections, key-value pairs, and comments starting with ; or #.
 */
export function parseIni(content: string): Record<string, Record<string, string>> {
  const lines = content.split(/\r?\n/);
  const result: Record<string, Record<string, string>> = Object.create(null);
  let currentSection = 'default';

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.*)\]$/);
    if (sectionMatch) {
      const sec = sectionMatch[1].trim();
      if (sec === '__proto__' || sec === 'constructor' || sec === 'prototype') {
        continue;
      }
      currentSection = sec;
      if (!result[currentSection]) {
        result[currentSection] = Object.create(null);
      }
      continue;
    }

    const firstEqual = line.indexOf('=');
    if (firstEqual > 0) {
      const key = line.substring(0, firstEqual).trim();
      const value = line.substring(firstEqual + 1).trim();
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      if (
        currentSection === '__proto__' ||
        currentSection === 'constructor' ||
        currentSection === 'prototype'
      ) {
        continue;
      }
      if (!result[currentSection]) {
        result[currentSection] = Object.create(null);
      }
      result[currentSection][key] = value;
    }
  }

  return result;
}
