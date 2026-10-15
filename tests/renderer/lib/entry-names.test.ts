import { describe, expect, it } from 'vitest';
import { invalidEntryNameReason } from '../../../src/renderer/src/lib/entry-names';

describe('invalidEntryNameReason', () => {
  it.each(['report.pdf', 'my folder', 'a.b.c', '...hidden'])('accepts %s', (name) => {
    expect(invalidEntryNameReason(name)).toBeNull();
  });

  it.each(['', '   ', '.', '..', 'a/b', '../etc', 'a\\b', 'bad\u0007name'])(
    'rejects %j',
    (name) => {
      expect(invalidEntryNameReason(name)).not.toBeNull();
    },
  );
});
