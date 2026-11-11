import { LIMITS } from '@shared/constants';
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStorageStore } from '@/stores/storage-store';
import { FilePreview } from '../../../../src/renderer/src/components/sftp/FilePreview';
import { installFakeApi } from '../../../../src/test/fake-api';

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

  it('closes only the search bar on Escape, not the whole preview', () => {
    // Regression: the capture handler closed the search, then the same event
    // reached DialogShell's Escape handler and closed the preview.
    useStorageStore.getState().setPreviewFile({
      name: 'notes.txt',
      content: 'needle in a haystack',
      type: 'text/plain',
      path: '/home/user/notes.txt',
      isLocal: true,
    });
    render(<FilePreview />);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    expect(useStorageStore.getState().previewFile).not.toBeNull();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });

  it('closes the preview on a plain Escape', () => {
    useStorageStore.getState().setPreviewFile({
      name: 'notes.txt',
      content: 'x',
      type: 'text/plain',
      path: '/home/user/notes.txt',
      isLocal: true,
    });
    render(<FilePreview />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStorageStore.getState().previewFile).toBeNull();
  });
});

describe('FilePreview save lifecycle', () => {
  const file = {
    name: 'file.txt',
    content: 'original',
    type: 'text/plain',
    path: '/home/user/file.txt',
    isLocal: true,
  };
  let api: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    api = installFakeApi();
    useStorageStore.getState().setPreviewFile(file);
  });
  it('preserves text entered while saving and leaves the new edits dirty', async () => {
    let finish!: () => void;
    api.shell.writeFile.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<FilePreview />);
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    fireEvent.change(editor, { target: { value: 'saved version' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(editor).not.toBeDisabled();
    fireEvent.change(editor, { target: { value: 'newer unsaved edits' } });
    await act(async () => finish());
    expect(editor).toHaveValue('newer unsaved edits');
    expect(useStorageStore.getState().previewFile?.content).toBe('saved version');
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });
  it.each(['closed', 'different', 'same path reopened'])(
    'does not restore a stale document after it is %s',
    async (scenario) => {
      let finish!: () => void;
      api.shell.writeFile.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      render(<FilePreview />);
      fireEvent.change(screen.getByRole('textbox', { name: 'File contents' }), {
        target: { value: 'old save' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      const next =
        scenario === 'closed'
          ? null
          : {
              ...file,
              path: scenario === 'different' ? '/home/user/other.txt' : file.path,
              content: 'new document',
            };
      act(() => useStorageStore.getState().setPreviewFile(next));
      await act(async () => finish());
      expect(useStorageStore.getState().previewFile).toEqual(next);
      if (next)
        expect(screen.getByRole('textbox', { name: 'File contents' })).toHaveValue('new document');
      else expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );
  it('retains dirty edits after a failed save', async () => {
    api.shell.writeFile.mockRejectedValueOnce(new Error('disk full'));
    render(<FilePreview />);
    fireEvent.change(screen.getByRole('textbox', { name: 'File contents' }), {
      target: { value: 'keep this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    expect(screen.getByRole('textbox', { name: 'File contents' })).toHaveValue('keep this');
    expect(useStorageStore.getState().previewFile?.content).toBe('original');
  });
  it('opens oversized text read-only and explains the editing limit', () => {
    useStorageStore
      .getState()
      .setPreviewFile({ ...file, content: 'x'.repeat(LIMITS.MAX_EDITABLE_BYTES + 1) });
    render(<FilePreview />);
    expect(screen.getByRole('textbox', { name: 'File contents' })).toHaveAttribute('readonly');
    expect(screen.getByRole('status')).toHaveTextContent('Read-only');
  });
  it('preserves oversized edits but disables Save until text is within the limit', () => {
    render(<FilePreview />);
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    fireEvent.change(editor, { target: { value: 'x'.repeat(LIMITS.MAX_EDITABLE_BYTES + 1) } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(editor).not.toHaveAttribute('readonly');
    fireEvent.change(editor, { target: { value: 'small' } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });
});

describe('preview usability', () => {
  beforeEach(() => {
    installFakeApi();
    useStorageStore.getState().setPreviewFile({
      name: 'test.txt',
      path: '/home/user/test.txt',
      type: 'text/plain',
      content: 'line\n'.repeat(1000),
      isLocal: true,
    });
  });
  it('names the search field and close control and returns Escape to the preview', () => {
    render(<FilePreview />);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(screen.getByRole('textbox', { name: 'Search in file' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close file search' }));
    expect(screen.queryByRole('textbox', { name: 'Search in file' })).not.toBeInTheDocument();
  });
  it('retains bounded line numbers when a scrolled document shrinks', () => {
    render(<FilePreview />);
    const editor = screen.getByRole('textbox', { name: 'File contents' });
    fireEvent.scroll(editor, { target: { scrollTop: 16000 } });
    fireEvent.change(editor, { target: { value: 'short' } });
    expect(editor).toHaveValue('short');
    expect(document.querySelectorAll('[data-line-number]').length).toBe(1);
    expect(document.querySelector('[data-line-number]')).toHaveAttribute('data-line-number', '1');
  });
  it('describes follow-bottom as following loaded content rather than live reload', () => {
    render(<FilePreview />);
    const button = screen.getByRole('button', { name: 'Follow bottom' });
    expect(button).toHaveAttribute('title', expect.stringContaining('does not reload'));
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Follow bottom ON')).toBeInTheDocument();
  });
});
