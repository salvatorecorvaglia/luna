// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStorageStore } from '@/stores/storage-store';
import { FilePreview } from '../FilePreview';

describe('FilePreview component', () => {
  beforeEach(() => {
    useStorageStore.getState().setPreviewFile(null);
  });

  it('renders nothing when previewFile is null', () => {
    const { container } = render(<FilePreview />);
    expect(container.firstChild).toBeNull();
  });

  it('renders text file content and language tag', () => {
    useStorageStore.getState().setPreviewFile({
      name: 'script.py',
      content: 'print("hello world")',
      type: 'text/plain',
      path: '/home/user/script.py',
      isLocal: true,
    });

    render(<FilePreview />);

    expect(screen.getByText('script.py')).toBeInTheDocument();
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByDisplayValue('print("hello world")')).toBeInTheDocument();
  });

  it('detects dirty state when editing text content', () => {
    useStorageStore.getState().setPreviewFile({
      name: 'doc.txt',
      content: 'original content',
      type: 'text/plain',
      path: '/home/user/doc.txt',
      isLocal: true,
    });

    render(<FilePreview />);

    const textarea = screen.getByDisplayValue('original content');
    fireEvent.change(textarea, { target: { value: 'edited content' } });

    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('renders image preview for image MIME types', () => {
    useStorageStore.getState().setPreviewFile({
      name: 'logo.png',
      content:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      type: 'image/png',
      path: '/home/user/logo.png',
      isLocal: true,
    });

    render(<FilePreview />);

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('alt', 'logo.png');
  });

  it('closes preview when close button is clicked', () => {
    useStorageStore.getState().setPreviewFile({
      name: 'read.md',
      content: '# Title',
      type: 'text/plain',
      path: '/home/user/read.md',
      isLocal: true,
    });

    render(<FilePreview />);

    fireEvent.click(screen.getByLabelText('Close preview'));
    expect(useStorageStore.getState().previewFile).toBeNull();
  });
});
