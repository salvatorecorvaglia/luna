import { describe, expect, it } from 'vitest';
import { cliReferenceService } from '../../../src/main/services/cli-reference-service';

describe('CliReferenceService.searchDocs', () => {
  it('returns every doc when no query is given', () => {
    const all = cliReferenceService.searchDocs();
    expect(all.length).toBeGreaterThan(5);
    expect(all.some((d) => d.name === 'tar')).toBe(true);
  });

  it('returns every doc for a blank/whitespace-only query', () => {
    expect(cliReferenceService.searchDocs('   ').length).toBe(
      cliReferenceService.searchDocs().length,
    );
  });

  it('matches by command name, case-insensitively', () => {
    const results = cliReferenceService.searchDocs('DOCKER');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('docker');
  });

  it('matches by summary text', () => {
    const results = cliReferenceService.searchDocs('kubernetes');
    expect(results.some((d) => d.name === 'kubectl')).toBe(true);
  });

  it('matches by example description or command text', () => {
    const results = cliReferenceService.searchDocs('gzipped');
    expect(results.some((d) => d.name === 'tar')).toBe(true);
  });

  it('returns an empty array when nothing matches', () => {
    expect(cliReferenceService.searchDocs('no-such-tool-xyz')).toEqual([]);
  });
});

describe('CliReferenceService.getDoc', () => {
  it('looks up a doc by exact name, case-insensitively', () => {
    expect(cliReferenceService.getDoc('GREP')?.name).toBe('grep');
    expect(cliReferenceService.getDoc('grep')?.name).toBe('grep');
  });

  it('returns null for an unknown command', () => {
    expect(cliReferenceService.getDoc('not-a-real-command')).toBeNull();
  });
});
