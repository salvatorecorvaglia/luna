import { describe, expect, it } from 'vitest';
import { BINARY_PREVIEW_EXTENSIONS } from '../../src/shared/constants';
import {
  fileExtension,
  isPreviewImageMime,
  PREVIEW_IMAGE_MIME,
  previewMimeForExt,
} from '../../src/shared/file-types';

describe('file-types', () => {
  it('renders every image extension main base64-encodes as an image', () => {
    // Regression: .ico/.bmp were base64-encoded by main and labelled image/*,
    // but the previewer didn't treat those MIME types as images, so the base64
    // opened in the text editor and Save wrote it back over the file.
    for (const ext of BINARY_PREVIEW_EXTENSIONS) {
      if (ext === 'pdf') continue;
      const mime = previewMimeForExt(ext);
      expect(mime, ext).not.toBeNull();
      expect(isPreviewImageMime(mime!), ext).toBe(true);
    }
    expect(isPreviewImageMime(PREVIEW_IMAGE_MIME.ico!)).toBe(true);
    expect(isPreviewImageMime(PREVIEW_IMAGE_MIME.bmp!)).toBe(true);
  });

  it('opens text extensions as text and refuses unknown ones', () => {
    expect(previewMimeForExt('md')).toBe('text/plain');
    expect(previewMimeForExt('exe')).toBeNull();
    expect(previewMimeForExt('')).toBeNull();
  });

  it('extracts a lower-cased extension', () => {
    expect(fileExtension('Photo.JPG')).toBe('jpg');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    // No dot: the whole name, so Makefile/Dockerfile preview as text.
    expect(fileExtension('Makefile')).toBe('makefile');
    expect(previewMimeForExt(fileExtension('Dockerfile'))).toBe('text/plain');
  });
});
