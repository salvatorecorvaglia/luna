// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStorageStore } from '@/stores/storage-store';

// FileList renders @tanstack/react-virtual which depends on layout APIs that
// jsdom only partially implements. Stub it to a deterministic table-of-names
// so the FilePane tests focus on what FilePane actually owns.
vi.mock('../FileList', () => ({
  FileList: ({ entries }: { entries: { name: string }[] }) => (
    <ul data-testid="filelist">
      {entries.map((e) => (
        <li key={e.name}>{e.name}</li>
      ))}
    </ul>
  ),
}));

import { FilePane, type FileEntry } from '../FilePane';

const baseProps = {
  title: 'Local',
  isLoading: false,
  error: null,
  selection: new Set<string>(),
  onPathChange: vi.fn(),
  onSelect: vi.fn(),
  onRefresh: vi.fn(),
  side: 'local' as const,
};

const sampleEntries: FileEntry[] = [
  {
    name: 'docs',
    path: '/home/me/docs',
    size: 0,
    modifiedAt: 0,
    isDirectory: true,
    isSymlink: false,
  },
  {
    name: '.bashrc',
    path: '/home/me/.bashrc',
    size: 100,
    modifiedAt: 0,
    isDirectory: false,
    isSymlink: false,
  },
  {
    name: 'notes.txt',
    path: '/home/me/notes.txt',
    size: 200,
    modifiedAt: 0,
    isDirectory: false,
    isSymlink: false,
  },
];

beforeEach(() => {
  baseProps.onPathChange.mockReset();
  baseProps.onSelect.mockReset();
  baseProps.onRefresh.mockReset();
});

describe('FilePane breadcrumbs', () => {
  it('renders one button per breadcrumb segment, plus the home button', () => {
    render(<FilePane {...baseProps} path="/home/me/docs" entries={[]} />);
    // Home + /home + /me + /docs = 4 navigation buttons (the "home" icon button has aria-label).
    expect(screen.getByLabelText('Navigate to root directory')).toBeInTheDocument();
    expect(screen.getByLabelText('Navigate to /home')).toBeInTheDocument();
    expect(screen.getByLabelText('Navigate to /home/me')).toBeInTheDocument();
    expect(screen.getByLabelText('Navigate to /home/me/docs')).toBeInTheDocument();
  });

  it('marks only the active segment with aria-current="page"', () => {
    render(<FilePane {...baseProps} path="/home/me/docs" entries={[]} />);
    expect(screen.getByLabelText('Navigate to /home/me/docs')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByLabelText('Navigate to /home/me')).not.toHaveAttribute('aria-current');
  });

  it('clicking a non-active breadcrumb invokes onPathChange', () => {
    render(<FilePane {...baseProps} path="/home/me/docs" entries={[]} />);
    fireEvent.click(screen.getByLabelText('Navigate to /home'));
    expect(baseProps.onPathChange).toHaveBeenCalledWith('/home');
  });
});

describe('FilePane filter', () => {
  it('opens the filter input when the toggle is clicked', () => {
    render(<FilePane {...baseProps} path="/home/me" entries={sampleEntries} />);
    expect(screen.queryByPlaceholderText('Filter files...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Filter files'));
    expect(screen.getByPlaceholderText('Filter files...')).toBeInTheDocument();
  });

  it('hides hidden files when showHidden is false', () => {
    render(<FilePane {...baseProps} path="/home/me" entries={sampleEntries} showHidden={false} />);
    expect(screen.queryByText('.bashrc')).not.toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });
});

describe('FilePane error and empty states', () => {
  it('shows an error block when error is set', () => {
    render(
      <FilePane
        {...baseProps}
        path="/home/me"
        entries={[]}
        error={new Error('Permission denied')}
      />,
    );
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
  });

  it('renders nothing through the FileList stub when entries is empty', () => {
    render(<FilePane {...baseProps} path="/home/me" entries={[]} />);
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});

describe('FilePane list truncation banner', () => {
  beforeEach(() => {
    useStorageStore.getState().setPathTruncated('session-123', '/remote/path', false);
    useStorageStore.getState().setActiveSessionId(null);
  });

  it('renders a warning banner when isTruncated is true and side is remote', () => {
    useStorageStore.getState().setActiveSessionId('session-123');
    useStorageStore.getState().setPathTruncated('session-123', '/remote/path', true);

    const remoteProps = {
      ...baseProps,
      side: 'remote' as const,
    };

    const { rerender } = render(<FilePane {...remoteProps} path="/remote/path" entries={[]} />);
    expect(screen.getByText(/List Truncated:/i)).toBeInTheDocument();

    // Rerender with a non-truncated path and ensure banner disappears
    rerender(<FilePane {...remoteProps} path="/other/path" entries={[]} />);
    expect(screen.queryByText(/List Truncated:/i)).not.toBeInTheDocument();
  });
});
