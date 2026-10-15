/**
 * The single source of truth for what the file previewer can show and how.
 *
 * These lists used to live in four places — the shared binary-extension set
 * (main: how to encode the bytes), SftpManager (which extensions open and
 * with what MIME type) and FilePreview (which MIME types render as images) —
 * and they disagreed: .ico/.bmp were read as base64 and labelled image/*, but
 * FilePreview didn't recognise those MIME types, so the base64 text opened in
 * the editor and saving it wrote the base64 back over the image.
 */

/** Extension → MIME type for images the previewer renders with <img>. */
export const PREVIEW_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
};

export const PDF_MIME = 'application/pdf';

/** Extensions opened as editable text. */
export const TEXT_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'log',
  'sh',
  'bash',
  'zsh',
  'py',
  'js',
  'ts',
  'tsx',
  'jsx',
  'html',
  'css',
  'scss',
  'conf',
  'cfg',
  'ini',
  'toml',
  'env',
  'gitignore',
  'editorconfig',
  'makefile',
  'dockerfile',
  'rs',
  'go',
  'rb',
  'php',
  'java',
  'c',
  'h',
  'cpp',
]);

/**
 * Extensions whose bytes main must return base64-encoded rather than as UTF-8
 * text: every previewable image, plus PDF.
 */
export const BINARY_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.keys(PREVIEW_IMAGE_MIME),
  'pdf',
]);

/**
 * Lower-cased text after the last dot — or the whole name when there is no
 * dot, which is what lets extension-less files like `Makefile` and
 * `Dockerfile` match TEXT_PREVIEW_EXTENSIONS.
 */
export function fileExtension(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** MIME type to preview `ext` as, or null when it can't be previewed. */
export function previewMimeForExt(ext: string): string | null {
  const image = PREVIEW_IMAGE_MIME[ext];
  if (image) return image;
  if (ext === 'pdf') return PDF_MIME;
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return 'text/plain';
  return null;
}

const IMAGE_MIMES = new Set(Object.values(PREVIEW_IMAGE_MIME));

/** Whether a preview MIME type renders as an image. */
export function isPreviewImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}
