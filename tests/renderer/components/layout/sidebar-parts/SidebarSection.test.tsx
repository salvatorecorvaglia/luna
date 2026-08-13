// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import type { Connection } from '@shared/types/ipc';
import type { UseMutationResult } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarSection } from '../../../../../src/renderer/src/components/layout/sidebar-parts/SidebarSection';

interface FolderGroupPropsMock {
  name: string;
  onReorder: (newOrder: Connection[]) => void;
  connections: Connection[];
}

// Mock FolderGroup so we can easily trigger its onReorder callback
vi.mock('../../../../../src/renderer/src/components/layout/sidebar-parts/FolderGroup', () => ({
  FolderGroup: ({ name, onReorder, connections }: FolderGroupPropsMock) => {
    return (
      <div data-testid={`folder-${name}`}>
        <button
          type="button"
          data-testid={`reorder-trigger-${name}`}
          onClick={() => {
            // Reverse the order of connections within this folder group
            onReorder([...connections].reverse());
          }}
        >
          Reorder {name}
        </button>
      </div>
    );
  },
}));

// Mock framer-motion Reorder components to avoid animation-loop timers in jsdom
vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  useDragControls: () => ({
    start: vi.fn(),
  }),
}));

describe('SidebarSection handleReorderFolder', () => {
  const mockMutation = {
    mutate: vi.fn(),
    isPending: false,
  } as unknown as UseMutationResult<void, Error, string[], unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly reorders connections when items of the folder are contiguous', () => {
    const setSshConnections = vi.fn();
    const connections = [
      { id: '1', name: 'Conn 1', folder: 'A', provider: 'sftp' },
      { id: '2', name: 'Conn 2', folder: 'A', provider: 'sftp' },
      { id: '3', name: 'Conn 3', folder: 'B', provider: 'sftp' },
    ] as unknown as Connection[];

    render(
      <SidebarSection
        sectionId="ssh"
        groupedByProvider={{ sftp: connections, s3: [] }}
        localSshConnections={connections}
        setLocalSshConnections={setSshConnections}
        localS3Connections={[]}
        setLocalS3Connections={vi.fn()}
        setIsDraggingConnection={vi.fn()}
        draggingSection={null}
        setDraggingSection={vi.fn()}
        reorderMutation={mockMutation}
      />,
    );

    const trigger = screen.getByTestId('reorder-trigger-A');
    fireEvent.click(trigger);

    expect(setSshConnections).toHaveBeenCalledWith([
      { id: '2', name: 'Conn 2', folder: 'A', provider: 'sftp' },
      { id: '1', name: 'Conn 1', folder: 'A', provider: 'sftp' },
      { id: '3', name: 'Conn 3', folder: 'B', provider: 'sftp' },
    ]);
  });

  it('correctly reorders folder connections and PRESERVES interleaved connections of other folders', () => {
    const setSshConnections = vi.fn();

    // Connections from folder A are interleaved with folder B in the raw list
    const connections = [
      { id: '1', name: 'Conn 1 (A)', folder: 'A', provider: 'sftp' },
      { id: '2', name: 'Conn 2 (B)', folder: 'B', provider: 'sftp' },
      { id: '3', name: 'Conn 3 (A)', folder: 'A', provider: 'sftp' },
    ] as unknown as Connection[];

    render(
      <SidebarSection
        sectionId="ssh"
        groupedByProvider={{ sftp: connections, s3: [] }}
        localSshConnections={connections}
        setLocalSshConnections={setSshConnections}
        localS3Connections={[]}
        setLocalS3Connections={vi.fn()}
        setIsDraggingConnection={vi.fn()}
        draggingSection={null}
        setDraggingSection={vi.fn()}
        reorderMutation={mockMutation}
      />,
    );

    const trigger = screen.getByTestId('reorder-trigger-A');
    fireEvent.click(trigger);

    // Reordering A should swap index 0 ('1') and index 2 ('3') while leaving index 1 ('2') untouched.
    // The old splice logic would have called updatedConnections.splice(0, 2, ...newOrder),
    // resulting in deleting '2' (Conn 2 (B)) completely!
    expect(setSshConnections).toHaveBeenCalledWith([
      { id: '3', name: 'Conn 3 (A)', folder: 'A', provider: 'sftp' },
      { id: '2', name: 'Conn 2 (B)', folder: 'B', provider: 'sftp' },
      { id: '1', name: 'Conn 1 (A)', folder: 'A', provider: 'sftp' },
    ]);
  });
});
