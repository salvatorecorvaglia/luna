import { describe, expect, it } from 'vitest';
import { joinS3Path, parseS3Path } from '../s3-paths';

describe('parseS3Path', () => {
  it('returns null bucket and empty key for the virtual root', () => {
    expect(parseS3Path('/')).toEqual({ bucket: null, key: '' });
    expect(parseS3Path('')).toEqual({ bucket: null, key: '' });
  });

  it('parses bucket-only paths', () => {
    expect(parseS3Path('/my-bucket')).toEqual({ bucket: 'my-bucket', key: '' });
  });

  it('parses bucket + key', () => {
    expect(parseS3Path('/b/foo/bar.txt')).toEqual({ bucket: 'b', key: 'foo/bar.txt' });
  });

  it('preserves nested keys with multiple slashes', () => {
    expect(parseS3Path('/b/a/b/c/')).toEqual({ bucket: 'b', key: 'a/b/c/' });
  });
});

describe('joinS3Path', () => {
  it('returns just the bucket when key is empty', () => {
    expect(joinS3Path('b', '')).toBe('/b');
  });

  it('joins bucket and key with a single slash', () => {
    expect(joinS3Path('b', 'foo/bar')).toBe('/b/foo/bar');
  });
});
