// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorageStore } from '@/stores/storage-store';

// FileList renders @tanstack/react-virtual which depends on layout APIs that
// jsdom only partially implements. Stub it to a deterministic table-of-names
// so the FilePane tests focus on what FilePane actually owns.
vi.mock('../../../../src/renderer/src/components/sftp/FileList', () => ({
  FileList: ({ entries }: { entries: { name: string }[] }) => (
    <ul data-testid="filelist">
      {entries.map((e) => (
        <li key={e.name}>{e.name}</li>
      ))}
    </ul>
  ),
}));

import { type FileEntry, FilePane } from '../../../../src/renderer/src/components/sftp/FilePane';

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

/**
 * `shell:readdir` refuses to list outside the home subtree, so a local pane
 * that still offered `/`, `/Users`, or a "go up" past home put the user in a
 * dead end: every remaining control returned "Access denied", and the
 * breadcrumbs — derived from the failed path — offered no way back.
 */
describe('FilePane rootPath clamping', () => {
  const rooted = { ...baseProps, rootPath: '/home/me' };

  it('renders no breadcrumbs above the root', () => {
    render(<FilePane {...rooted} path="/home/me/docs" entries={[]} />);
    expect(screen.getByLabelText('Navigate to /home/me/docs')).toBeInTheDocument();
    expect(screen.queryByLabelText('Navigate to /home/me')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navigate to /home')).not.toBeInTheDocument();
  });

  it('sends the home button to the root, not to /', () => {
    render(<FilePane {...rooted} path="/home/me/docs" entries={[]} />);
    fireEvent.click(screen.getByLabelText('Navigate to home folder'));
    expect(rooted.onPathChange).toHaveBeenCalledWith('/home/me');
  });

  it('disables "go up" at the root', () => {
    render(<FilePane {...rooted} path="/home/me" entries={[]} />);
    expect(screen.getByLabelText('Go up')).toBeDisabled();
  });

  it('allows "go up" below the root, stopping at it', () => {
    render(<FilePane {...rooted} path="/home/me/docs" entries={[]} />);
    fireEvent.click(screen.getByLabelText('Go up'));
    expect(rooted.onPathChange).toHaveBeenCalledWith('/home/me');
  });

  it('clamps a "go up" that would escape the root', () => {
    // A path from outside the root (e.g. persisted by an older build).
    render(<FilePane {...rooted} path="/etc/ssh" entries={[]} />);
    fireEvent.click(screen.getByLabelText('Go up'));
    expect(rooted.onPathChange).toHaveBeenCalledWith('/home/me');
  });
});

describe('FilePane permissions column', () => {
  // `shell:readdir` never populates `permissions`, so a local pane showed an
  // 84px column of em dashes.
  it('is hidden on local panes', () => {
    render(<FilePane {...baseProps} path="/home/me" entries={[]} isLoading />);
    expect(screen.queryByText('Perms')).not.toBeInTheDocument();
  });

  it('is shown on SFTP remote panes', () => {
    render(
      <FilePane
        {...baseProps}
        side="remote"
        remoteKind="sftp"
        path="/srv"
        entries={[]}
        isLoading
      />,
    );
    expect(screen.getByText('Perms')).toBeInTheDocument();
  });

  it('is hidden on S3 remote panes', () => {
    render(
      <FilePane {...baseProps} side="remote" remoteKind="s3" path="/srv" entries={[]} isLoading />,
    );
    expect(screen.queryByText('Perms')).not.toBeInTheDocument();
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
