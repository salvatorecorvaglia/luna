import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ConnectionState {
  activeConnectionId: string | null;
  quickConnectValue: string;
  connectionFormOpen: boolean;
  editingConnectionId: string | null;
  duplicatingConnectionId: string | null;

  setActiveConnectionId: (id: string | null) => void;
  setQuickConnectValue: (value: string) => void;
  setConnectionFormOpen: (open: boolean) => void;
  setEditingConnectionId: (id: string | null) => void;
  openEditForm: (id: string) => void;
  openCreateForm: () => void;
  openDuplicateForm: (id: string) => void;
  closeForm: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      activeConnectionId: null,
      quickConnectValue: '',
      connectionFormOpen: false,
      editingConnectionId: null,
      duplicatingConnectionId: null,

      setActiveConnectionId: (id) => set({ activeConnectionId: id }),
      setQuickConnectValue: (value) => set({ quickConnectValue: value }),
      setConnectionFormOpen: (open) => set({ connectionFormOpen: open }),
      setEditingConnectionId: (id) => set({ editingConnectionId: id }),
      openEditForm: (id) =>
        set({ connectionFormOpen: true, editingConnectionId: id, duplicatingConnectionId: null }),
      openCreateForm: () =>
        set({ connectionFormOpen: true, editingConnectionId: null, duplicatingConnectionId: null }),
      openDuplicateForm: (id) =>
        set({ connectionFormOpen: true, editingConnectionId: null, duplicatingConnectionId: id }),
      closeForm: () =>
        set({
          connectionFormOpen: false,
          editingConnectionId: null,
          duplicatingConnectionId: null,
        }),
    }),
    {
      name: 'luna-connection-storage',
      partialize: (state) => ({
        activeConnectionId: state.activeConnectionId,
      }),
    },
  ),
);
