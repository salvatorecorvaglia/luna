// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FileList } from '../FileList';
import type { FileEntry } from '../FilePane';

// Mock the virtualizer so that all items render deterministically in jsdom
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const items = Array.from({ length: count }, (_, i) => ({
      index: i,
      key: i,
      start: i * 32,
      size: 32,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * 32,
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    };
  },
}));

// Mock ContextMenu component so we don't pull in extra layout/floating UI logic
vi.mock('@/components/common/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu">{children}</div>
  ),
}));

const mockEntries: FileEntry[] = [
  {
    name: 'src',
    path: '/project/src',
    size: 0,
    modifiedAt: 1600000000,
    isDirectory: true,
    isSymlink: false,
  },
  {
    name: 'package.json',
    path: '/project/package.json',
    size: 1024,
    modifiedAt: 1650000000,
    isDirectory: false,
    isSymlink: false,
    permissions: '-rw-r--r--',
  },
  {
    name: 'readme.md',
    path: '/project/readme.md',
    size: 2048,
    modifiedAt: 1620000000,
    isDirectory: false,
    isSymlink: false,
    permissions: '-rwxr-xr-x',
  },
];

describe('FileList component', () => {
  const defaultProps = {
    entries: mockEntries,
    selection: new Set<string>(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onCopyPath: vi.fn(),
    onPreview: vi.fn(),
    onDownload: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders entries with their names and formatted sizes', () => {
    render(<FileList {...defaultProps} />);

    // Directory name and files should be rendered
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
    expect(screen.getByText('readme.md')).toBeInTheDocument();

    // Directory size should render as dash
    expect(
      screen.getByTitle('/project/src').closest('[role="option"]')?.querySelector('.w-20')
        ?.textContent,
    ).toBe('—');

    // File sizes should be formatted (1024 B -> 1.0 KB, 2048 B -> 2.0 KB)
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('handles item selection clicks', () => {
    render(<FileList {...defaultProps} />);

    const fileRow = screen.getByText('package.json');
    fireEvent.click(fileRow);

    expect(defaultProps.onSelect).toHaveBeenCalledTimes(1);
    // Should call onSelect with a Set containing 'package.json'
    const selectionArg = defaultProps.onSelect.mock.calls[0][0] as Set<string>;
    expect(selectionArg.has('package.json')).toBe(true);
  });

  it('handles double-click to open directory/file', () => {
    render(<FileList {...defaultProps} />);

    const dirRow = screen.getByText('src');
    fireEvent.doubleClick(dirRow);

    expect(defaultProps.onOpen).toHaveBeenCalledTimes(1);
    expect(defaultProps.onOpen).toHaveBeenCalledWith(mockEntries[0]);
  });

  it('renders permissions column when showPermissions is true', () => {
    const { rerender } = render(<FileList {...defaultProps} showPermissions={false} />);
    expect(screen.queryByText('Perms')).not.toBeInTheDocument();

    rerender(<FileList {...defaultProps} showPermissions={true} />);
    expect(screen.getByText('Perms')).toBeInTheDocument();
    expect(screen.getByText('-rw-r--r--')).toBeInTheDocument();
    expect(screen.getByText('-rwxr-xr-x')).toBeInTheDocument();
  });

  it('renders empty message when there are no entries', () => {
    render(<FileList {...defaultProps} entries={[]} emptyMessage="Custom empty message" />);
    expect(screen.getByText('Custom empty message')).toBeInTheDocument();
  });

  it('sorts entries by clicking headers', () => {
    render(<FileList {...defaultProps} />);

    // Initial sort is by name ascending (directories first, then files)
    // List order: 'src' (dir), 'package.json' (file), 'readme.md' (file)
    let rows = screen
      .getAllByRole('option')
      .map((row) => row.querySelector('.truncate')?.textContent);
    expect(rows).toEqual(['src', 'package.json', 'readme.md']);

    // Click on Size header to sort by size ascending (dir is still first since directories always stay on top)
    fireEvent.click(screen.getByRole('columnheader', { name: /Size/i }));
    rows = screen.getAllByRole('option').map((row) => row.querySelector('.truncate')?.textContent);
    expect(rows).toEqual(['src', 'package.json', 'readme.md']); // package.json (1.0 KB) < readme.md (2.0 KB)

    // Click on Size header again to sort by size descending
    fireEvent.click(screen.getByRole('columnheader', { name: /Size/i }));
    rows = screen.getAllByRole('option').map((row) => row.querySelector('.truncate')?.textContent);
    expect(rows).toEqual(['src', 'readme.md', 'package.json']); // readme.md (2.0 KB) > package.json (1.0 KB)
  });
});
