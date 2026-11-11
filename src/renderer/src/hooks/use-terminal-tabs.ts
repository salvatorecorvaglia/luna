import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  getFirstLeafSessionId,
  hasSessionInTree,
  selectTabsByKind,
  useActiveSessionId,
  useTerminalStore,
} from '@/stores/terminal-store';

export function useTerminalTabs(kind: 'ssh' | 'local') {
  const active = useActiveSessionId();
  const layouts = useTerminalStore((s) => s.layouts);
  const setActive = useTerminalStore((s) => s.setActiveSession);
  const setOrder = useTerminalStore((s) => s.setTabOrder);
  const tabs = useTerminalStore(useShallow((s) => selectTabsByKind(s, kind)));
  const activeTabId = useMemo(
    () =>
      active
        ? (tabs.find((id) => {
            const root = layouts.get(id);
            return root && hasSessionInTree(root, active);
          }) ?? null)
        : null,
    [active, tabs, layouts],
  );
  const activate = useCallback(
    (id: string) => {
      const root = layouts.get(id);
      setActive(root ? getFirstLeafSessionId(root) : id);
    },
    [layouts, setActive],
  );
  const reorder = useCallback(
    (order: string[]) => {
      const other = selectTabsByKind(useTerminalStore.getState(), kind === 'ssh' ? 'local' : 'ssh');
      setOrder(kind === 'ssh' ? [...order, ...other] : [...other, ...order]);
    },
    [kind, setOrder],
  );
  return { tabs, layouts, activeTabId, activate, reorder };
}
