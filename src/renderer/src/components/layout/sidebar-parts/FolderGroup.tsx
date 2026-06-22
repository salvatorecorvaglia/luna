import { toastArgs } from '@shared/error-messages';
import type { Connection } from '@shared/types/ipc';
import type { UseMutationResult } from '@tanstack/react-query';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { ChevronRight, FolderClosed, Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { PromptDialog } from '@/components/common/PromptDialog';
import { useRenameFolder } from '@/hooks/use-connections';
import { cn } from '@/lib/utils';
import { DraggableConnectionItem } from './ConnectionItem';

interface FolderGroupProps {
  name: string;
  provider: 'sftp' | 's3';
  connections: Connection[];
  onReorder: (newOrder: Connection[]) => void;
  setIsDraggingConnection: (v: boolean) => void;
  draggingSection: string | null;
  reorderMutation: UseMutationResult<void, Error, string[], unknown>;
  allConnectionsInSection: Connection[];
}

export function FolderGroup({
  name,
  provider,
  connections,
  onReorder,
  setIsDraggingConnection,
  draggingSection,
  reorderMutation,
  allConnectionsInSection,
}: FolderGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const renameMutation = useRenameFolder();
  const isDefault = name === 'default';

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Rename Group',
      icon: <Pencil className="size-3.5" />,
      onClick: () => setShowRenameDialog(true),
    },
  ];

  return (
    <div className="space-y-0.5">
      {!isDefault && (
        <>
          <ContextMenu items={contextMenuItems}>
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="group/folder flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              <ChevronRight
                className={cn(
                  'size-3 text-muted-foreground/30 group-hover/folder:text-muted-foreground/60 transition-transform',
                  isOpen && 'rotate-90',
                )}
              />
              <FolderClosed className="size-3 text-muted-foreground/40 group-hover/folder:text-muted-foreground/70" />
              <span className="truncate">{name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/20 group-hover/folder:text-muted-foreground/50 tabular-nums">
                {connections.length}
              </span>
            </button>
          </ContextMenu>
          <PromptDialog
            open={showRenameDialog}
            title="Rename group"
            message={`Enter a new name for the group "${name}"`}
            placeholder="Group name"
            defaultValue={name}
            confirmLabel="Rename"
            onConfirm={(newName) => {
              renameMutation.mutate(
                { oldName: name, newName, provider },
                {
                  onSuccess: () => {
                    toast.success('Group renamed');
                    setShowRenameDialog(false);
                  },
                  onError: (err) => {
                    toast.error(...toastArgs(err, 'Rename failed'));
                  },
                },
              );
            }}
            onCancel={() => setShowRenameDialog(false)}
          />
        </>
      )}

      <AnimatePresence initial={false}>
        {(isDefault || isOpen) && (
          <motion.div
            initial={isDefault ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <Reorder.Group
              axis="y"
              values={connections}
              onReorder={onReorder}
              className={cn('space-y-0.5', !isDefault && 'pl-2 ml-3.5 border-l border-border/30')}
            >
              {connections.map((conn) => (
                <DraggableConnectionItem
                  key={conn.id}
                  connection={conn}
                  disabled={!!draggingSection}
                  onDragStart={() => setIsDraggingConnection(true)}
                  onDragEnd={() => {
                    setIsDraggingConnection(false);
                    reorderMutation.mutate(allConnectionsInSection.map((c) => c.id));
                  }}
                />
              ))}
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
