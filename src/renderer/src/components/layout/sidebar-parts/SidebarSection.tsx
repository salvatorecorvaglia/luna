import type { Connection } from '@shared/types/ipc';
import type { UseMutationResult } from '@tanstack/react-query';
import { Reorder, useDragControls } from 'framer-motion';
import { FolderClosed, GripVertical, Terminal } from 'lucide-react';
import { useMemo } from 'react';
import { FolderGroup } from './FolderGroup';

interface SidebarSectionProps {
  sectionId: 'ssh' | 's3';
  groupedByProvider: { sftp: Connection[]; s3: Connection[] };
  localSshConnections: Connection[];
  setLocalSshConnections: (v: Connection[]) => void;
  localS3Connections: Connection[];
  setLocalS3Connections: (v: Connection[]) => void;
  setIsDraggingConnection: (v: boolean) => void;
  draggingSection: string | null;
  setDraggingSection: (v: string | null) => void;
  reorderMutation: UseMutationResult<void, Error, string[], unknown>;
}

export function SidebarSection({
  sectionId,
  groupedByProvider,
  localSshConnections,
  setLocalSshConnections,
  localS3Connections,
  setLocalS3Connections,
  setIsDraggingConnection,
  draggingSection,
  setDraggingSection,
  reorderMutation,
}: SidebarSectionProps) {
  const controls = useDragControls();
  const isSsh = sectionId === 'ssh';
  const connections = isSsh ? localSshConnections : localS3Connections;
  const setConnections = isSsh ? setLocalSshConnections : setLocalS3Connections;
  const hasConnections = isSsh
    ? groupedByProvider.sftp.length > 0
    : groupedByProvider.s3.length > 0;

  // Hooks must run in the same order every render — group/sort *before*
  // the early return so React's hook accounting stays stable when a
  // section transitions empty ↔ non-empty.
  const folders = useMemo(() => {
    const groups: Record<string, Connection[]> = {};
    for (const conn of connections) {
      const folder = conn.folder || 'default';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(conn);
    }
    return groups;
  }, [connections]);

  const sortedFolderNames = useMemo(() => {
    return Object.keys(folders).sort((a, b) => {
      if (a === 'default') return 1;
      if (b === 'default') return -1;
      return a.localeCompare(b);
    });
  }, [folders]);

  if (!hasConnections) return null;

  const handleReorderFolder = (folderName: string, newOrder: Connection[]) => {
    const updatedConnections = [...connections];
    const indices: number[] = [];
    for (let i = 0; i < updatedConnections.length; i++) {
      // Non-null: loop bound guarantees index i exists.
      if ((updatedConnections[i]!.folder || 'default') === folderName) {
        indices.push(i);
      }
    }
    for (let i = 0; i < indices.length; i++) {
      // Non-null: indices[i] is bounded by the loop above; newOrder is the
      // same folder's connections just reordered, so it has the same length.
      updatedConnections[indices[i]!] = newOrder[i]!;
    }
    setConnections(updatedConnections);
  };

  return (
    <Reorder.Item
      value={sectionId}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDraggingSection(sectionId)}
      onDragEnd={() => setTimeout(() => setDraggingSection(null), 100)}
      className="space-y-1 bg-sidebar"
    >
      <div
        onPointerDown={(e) => controls.start(e)}
        className="flex items-center justify-between px-2.5 pb-1 cursor-grab active:cursor-grabbing group/section"
      >
        <div className="flex items-center gap-1.5 text-3xs font-bold uppercase tracking-widest text-muted-foreground/50 group-hover/section:text-muted-foreground/80 transition-colors">
          {isSsh ? <Terminal className="size-3" /> : <FolderClosed className="size-3" />}
          <span>{isSsh ? 'SSH Sessions' : 'S3 Storage'}</span>
        </div>
        <GripVertical className="size-3 text-muted-foreground/20 opacity-0 group-hover/section:opacity-100 transition-opacity" />
      </div>

      <div className="space-y-1">
        {sortedFolderNames.map((folderName) => (
          <FolderGroup
            key={folderName}
            name={folderName}
            provider={isSsh ? 'sftp' : 's3'}
            // Non-null: folderName comes from Object.keys(folders).
            connections={folders[folderName]!}
            onReorder={(newOrder) => handleReorderFolder(folderName, newOrder)}
            setIsDraggingConnection={setIsDraggingConnection}
            draggingSection={draggingSection}
            reorderMutation={reorderMutation}
            allConnectionsInSection={connections}
          />
        ))}
      </div>
    </Reorder.Item>
  );
}
