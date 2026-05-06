# Command Sets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Command Sets" section to the sidebar that lets users define named groups of shell commands and send them to the active SSH session — individually or as a timed sequential template with expected-output validation.

**Architecture:** Full-stack Electron feature: new SQLite tables (`command_sets`, `command_set_items`) → new IPC handler (`command-set.ipc.ts`) → preload bridge → React Query hook → React UI components mounted inside `Sidebar.tsx`. Sequential execution logic lives entirely in the renderer, reusing the existing `ssh:send-data` / `ssh:on-data` IPC channels.

**Tech Stack:** better-sqlite3, Electron contextBridge, TanStack Query v5, React 18, Tailwind CSS v4, lucide-react, sonner (toasts), framer-motion (collapse animation)

---

## Task 1: Shared types

**Files:**

- Create: `src/shared/types/command-set.ts`
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/shared/constants.ts`

### Step 1: Create the shared type file

Create `src/shared/types/command-set.ts`:

```ts
export interface CommandSet {
  id: string;
  name: string;
  connectionId?: string; // undefined = global
  items: CommandSetItem[];
  sortOrder: number;
  createdAt: number;
}

export interface CommandSetItem {
  id: string;
  commandSetId: string;
  label: string;
  command: string;
  expectedOutput?: string; // regex string or plain substring
  timeoutMs: number; // default 10000
  sortOrder: number;
}

export interface CreateCommandSetInput {
  name: string;
  connectionId?: string;
  items: {
    label: string;
    command: string;
    expectedOutput?: string;
    timeoutMs?: number;
  }[];
}

export interface UpdateCommandSetInput {
  id: string;
  name?: string;
  items?: {
    label: string;
    command: string;
    expectedOutput?: string;
    timeoutMs?: number;
    sortOrder: number;
  }[];
}
```

### Step 2: Add IPC constants

In `src/shared/constants.ts`, add after the `// App update events` block (before the closing `} as const`):

```ts
  // Command Sets
  COMMAND_SET_LIST: 'command-set:list',
  COMMAND_SET_CREATE: 'command-set:create',
  COMMAND_SET_UPDATE: 'command-set:update',
  COMMAND_SET_DELETE: 'command-set:delete',
```

### Step 3: Add entries to IpcHandlerMap

In `src/shared/types/ipc.ts`:

1. Add import at the top:

```ts
import type { CommandSet, CreateCommandSetInput, UpdateCommandSetInput } from './command-set';
```

2. Add to `IpcHandlerMap` (before the closing `}`):

```ts
  // Command Sets
  'command-set:list': { request: void; response: CommandSet[] };
  'command-set:create': { request: CreateCommandSetInput; response: CommandSet };
  'command-set:update': { request: UpdateCommandSetInput; response: CommandSet };
  'command-set:delete': { request: string; response: void };
```

3. Add re-export at the bottom (with the other `export type *` lines):

```ts
export type * from './command-set';
```

### Step 4: Verify TypeScript compiles

```bash
npm run typecheck
```

Expected: no new errors.

### Step 5: Commit

```bash
git add src/shared/types/command-set.ts src/shared/types/ipc.ts src/shared/constants.ts
git commit -m "feat(command-sets): add shared types and IPC constants"
```

---

## Task 2: Database migration

**Files:**

- Modify: `src/main/services/database.ts`

### Step 1: Add migration `008_command_sets`

In `src/main/services/database.ts`, inside `getMigrations()`, append after the `007_connection_indexes` entry:

```ts
    {
      name: '008_command_sets',
      sql: `
        CREATE TABLE IF NOT EXISTS command_sets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          connection_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS command_set_items (
          id TEXT PRIMARY KEY,
          command_set_id TEXT NOT NULL,
          label TEXT NOT NULL,
          command TEXT NOT NULL,
          expected_output TEXT,
          timeout_ms INTEGER NOT NULL DEFAULT 10000,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (command_set_id) REFERENCES command_sets(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_command_sets_connection ON command_sets(connection_id);
        CREATE INDEX IF NOT EXISTS idx_command_set_items_set ON command_set_items(command_set_id);
      `,
    },
```

### Step 2: Add row interface

In `src/main/services/database.ts`, below the `ConnectionRow` interface, add:

```ts
export interface CommandSetRow {
  id: string;
  name: string;
  connection_id: string | null;
  sort_order: number;
  created_at: number;
}

export interface CommandSetItemRow {
  id: string;
  command_set_id: string;
  label: string;
  command: string;
  expected_output: string | null;
  timeout_ms: number;
  sort_order: number;
}
```

### Step 3: Verify TypeScript compiles

```bash
npm run typecheck
```

Expected: no errors.

### Step 4: Commit

```bash
git add src/main/services/database.ts
git commit -m "feat(command-sets): add DB migration 008 for command_sets tables"
```

---

## Task 3: IPC handler (main process)

**Files:**

- Create: `src/main/ipc/command-set.ipc.ts`
- Modify: `src/main/ipc/index.ts`

### Step 1: Create the IPC handler file

Create `src/main/ipc/command-set.ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { IPC } from '@shared/constants';
import { type CommandSetItemRow, type CommandSetRow, getDatabase } from '../services/database';
import type {
  CommandSet,
  CreateCommandSetInput,
  UpdateCommandSetInput,
} from '@shared/types/command-set';

function rowsToCommandSet(setRow: CommandSetRow, itemRows: CommandSetItemRow[]): CommandSet {
  return {
    id: setRow.id,
    name: setRow.name,
    connectionId: setRow.connection_id ?? undefined,
    sortOrder: setRow.sort_order,
    createdAt: setRow.created_at,
    items: itemRows
      .filter((r) => r.command_set_id === setRow.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({
        id: r.id,
        commandSetId: r.command_set_id,
        label: r.label,
        command: r.command,
        expectedOutput: r.expected_output ?? undefined,
        timeoutMs: r.timeout_ms,
        sortOrder: r.sort_order,
      })),
  };
}

export function registerCommandSetHandlers(): void {
  const db = getDatabase();

  ipcMain.handle(IPC.COMMAND_SET_LIST, (): CommandSet[] => {
    const setRows = db
      .prepare('SELECT * FROM command_sets ORDER BY sort_order ASC, created_at ASC')
      .all() as CommandSetRow[];
    if (setRows.length === 0) return [];
    const itemRows = db
      .prepare('SELECT * FROM command_set_items ORDER BY sort_order ASC')
      .all() as CommandSetItemRow[];
    return setRows.map((s) => rowsToCommandSet(s, itemRows));
  });

  ipcMain.handle(IPC.COMMAND_SET_CREATE, (_event, input: CreateCommandSetInput): CommandSet => {
    if (!input.name?.trim()) throw new Error('Command set name is required');
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const insertSet = db.prepare(
      'INSERT INTO command_sets (id, name, connection_id, created_at) VALUES (?, ?, ?, ?)',
    );
    const insertItem = db.prepare(
      `INSERT INTO command_set_items
         (id, command_set_id, label, command, expected_output, timeout_ms, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    db.transaction(() => {
      insertSet.run(id, input.name.trim(), input.connectionId ?? null, now);
      (input.items ?? []).forEach((item, idx) => {
        insertItem.run(
          uuidv4(),
          id,
          item.label,
          item.command,
          item.expectedOutput ?? null,
          item.timeoutMs ?? 10000,
          idx,
        );
      });
    })();

    const setRow = db.prepare('SELECT * FROM command_sets WHERE id = ?').get(id) as CommandSetRow;
    const itemRows = db
      .prepare('SELECT * FROM command_set_items WHERE command_set_id = ? ORDER BY sort_order ASC')
      .all(id) as CommandSetItemRow[];
    return rowsToCommandSet(setRow, itemRows);
  });

  ipcMain.handle(IPC.COMMAND_SET_UPDATE, (_event, input: UpdateCommandSetInput): CommandSet => {
    const existing = db.prepare('SELECT * FROM command_sets WHERE id = ?').get(input.id) as
      | CommandSetRow
      | undefined;
    if (!existing) throw new Error(`Command set not found: ${input.id}`);

    db.transaction(() => {
      if (input.name !== undefined) {
        db.prepare('UPDATE command_sets SET name = ? WHERE id = ?').run(
          input.name.trim(),
          input.id,
        );
      }
      if (input.items !== undefined) {
        db.prepare('DELETE FROM command_set_items WHERE command_set_id = ?').run(input.id);
        const insertItem = db.prepare(
          `INSERT INTO command_set_items
             (id, command_set_id, label, command, expected_output, timeout_ms, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        input.items.forEach((item, idx) => {
          insertItem.run(
            uuidv4(),
            input.id,
            item.label,
            item.command,
            item.expectedOutput ?? null,
            item.timeoutMs ?? 10000,
            item.sortOrder ?? idx,
          );
        });
      }
    })();

    const setRow = db
      .prepare('SELECT * FROM command_sets WHERE id = ?')
      .get(input.id) as CommandSetRow;
    const itemRows = db
      .prepare('SELECT * FROM command_set_items WHERE command_set_id = ? ORDER BY sort_order ASC')
      .all(input.id) as CommandSetItemRow[];
    return rowsToCommandSet(setRow, itemRows);
  });

  ipcMain.handle(IPC.COMMAND_SET_DELETE, (_event, id: string): void => {
    db.prepare('DELETE FROM command_sets WHERE id = ?').run(id);
  });
}
```

### Step 2: Register the handlers in `index.ts`

In `src/main/ipc/index.ts`, add:

```ts
import { registerCommandSetHandlers } from './command-set.ipc';
```

And inside `registerAllHandlers()`:

```ts
registerCommandSetHandlers();
```

### Step 3: Verify TypeScript compiles

```bash
npm run typecheck
```

Expected: no errors.

### Step 4: Commit

```bash
git add src/main/ipc/command-set.ipc.ts src/main/ipc/index.ts
git commit -m "feat(command-sets): add main process IPC handlers for CRUD"
```

---

## Task 4: Preload bridge

**Files:**

- Modify: `src/preload/index.ts`

### Step 1: Add imports

In `src/preload/index.ts`, add to the existing imports block:

```ts
import type { CreateCommandSetInput, UpdateCommandSetInput } from '@shared/types/command-set';
```

### Step 2: Add `commandSets` to the `api` object

In `src/preload/index.ts`, inside the `const api = { ... }` block, after the `app` section and before the closing `}`:

```ts
  // Command Sets
  commandSets: {
    list: () => invoke(IPC.COMMAND_SET_LIST),
    create: (input: CreateCommandSetInput) => invoke(IPC.COMMAND_SET_CREATE, input),
    update: (input: UpdateCommandSetInput) => invoke(IPC.COMMAND_SET_UPDATE, input),
    delete: (id: string) => invoke(IPC.COMMAND_SET_DELETE, id),
  },
```

### Step 3: Verify TypeScript compiles

```bash
npm run typecheck
```

Expected: no errors.

### Step 4: Commit

```bash
git add src/preload/index.ts
git commit -m "feat(command-sets): expose commandSets API via preload bridge"
```

---

## Task 5: React Query hook

**Files:**

- Create: `src/renderer/src/hooks/use-command-sets.ts`

### Step 1: Create the hook file

Create `src/renderer/src/hooks/use-command-sets.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCommandSetInput, UpdateCommandSetInput } from '@shared/types/command-set';

export function useCommandSets() {
  return useQuery({
    queryKey: ['command-sets'],
    queryFn: () => window.api.commandSets.list(),
    staleTime: Infinity,
  });
}

export function useCreateCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommandSetInput) => window.api.commandSets.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}

export function useUpdateCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCommandSetInput) => window.api.commandSets.update(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}

export function useDeleteCommandSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => window.api.commandSets.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['command-sets'] });
    },
  });
}
```

### Step 2: Verify TypeScript compiles

```bash
npm run typecheck
```

### Step 3: Commit

```bash
git add src/renderer/src/hooks/use-command-sets.ts
git commit -m "feat(command-sets): add React Query hooks for command set CRUD"
```

---

## Task 6: Sequential execution engine

**Files:**

- Create: `src/renderer/src/lib/command-set-runner.ts`

### Step 1: Create the runner

Create `src/renderer/src/lib/command-set-runner.ts`:

```ts
import type { CommandSetItem } from '@shared/types/command-set';

export type ItemStatus = 'idle' | 'running' | 'success' | 'failed';

export interface RunnerCallbacks {
  onItemStart: (itemId: string) => void;
  onItemSuccess: (itemId: string) => void;
  onItemFailed: (itemId: string, reason: string) => void;
  onComplete: () => void;
}

/**
 * Runs a list of CommandSetItems in sequence against the given SSH session.
 * For items with `expectedOutput`, listens on ssh:on-data until the output
 * matches or the timeout fires.
 * Returns a cancel function.
 */
export function runCommandSetSequence(
  items: CommandSetItem[],
  sessionId: string,
  callbacks: RunnerCallbacks,
): () => void {
  let cancelled = false;
  let cleanup: (() => void) | null = null;

  (async () => {
    for (const item of items) {
      if (cancelled) break;
      callbacks.onItemStart(item.id);

      window.api.ssh.sendData({ sessionId, data: item.command + '\n' });

      if (item.expectedOutput) {
        const matched = await waitForOutput(
          sessionId,
          item.expectedOutput,
          item.timeoutMs,
          (unsubscribe) => {
            cleanup = unsubscribe;
          },
        );
        cleanup = null;

        if (cancelled) break;

        if (!matched) {
          callbacks.onItemFailed(
            item.id,
            `Expected output not received within ${item.timeoutMs}ms`,
          );
          return; // abort sequence
        }
      } else {
        // No expected output — fixed 300ms delay before next item
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 300);
          // allow cancel to skip the delay
          const origCleanup = cleanup;
          cleanup = () => {
            clearTimeout(t);
            origCleanup?.();
            resolve();
          };
        });
        cleanup = null;
        if (cancelled) break;
      }

      callbacks.onItemSuccess(item.id);
    }

    if (!cancelled) callbacks.onComplete();
  })();

  return () => {
    cancelled = true;
    cleanup?.();
  };
}

function waitForOutput(
  sessionId: string,
  expected: string,
  timeoutMs: number,
  registerCleanup: (fn: () => void) => void,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let buffer = '';
    let resolved = false;

    let matcher: (s: string) => boolean;
    try {
      const re = new RegExp(expected);
      matcher = (s) => re.test(s);
    } catch {
      matcher = (s) => s.includes(expected);
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        unsubscribe();
        resolve(false);
      }
    }, timeoutMs);

    const unsubscribe = window.api.ssh.onData((event) => {
      if (event.sessionId !== sessionId || resolved) return;
      buffer += event.data;
      if (matcher(buffer)) {
        resolved = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      }
    });

    registerCleanup(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(false);
      }
    });
  });
}
```

### Step 2: Verify TypeScript compiles

```bash
npm run typecheck
```

Expected: no errors.

### Step 3: Commit

```bash
git add src/renderer/src/lib/command-set-runner.ts
git commit -m "feat(command-sets): add sequential execution engine with output matching"
```

---

## Task 7: CommandSetForm (create/edit modal)

**Files:**

- Create: `src/renderer/src/components/command-sets/CommandSetForm.tsx`

### Step 1: Create the form component

Create `src/renderer/src/components/command-sets/CommandSetForm.tsx`:

```tsx
import { useState } from 'react';
import { GripVertical, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommandSet, CommandSetItem, CreateCommandSetInput } from '@shared/types/command-set';
import type { Connection } from '@shared/types/connection';

interface DraftItem {
  label: string;
  command: string;
  expectedOutput: string;
  timeoutMs: number;
}

interface CommandSetFormProps {
  connections: Connection[];
  initialData?: CommandSet;
  onSubmit: (input: CreateCommandSetInput) => void;
  onCancel: () => void;
}

export function CommandSetForm({
  connections,
  initialData,
  onSubmit,
  onCancel,
}: CommandSetFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [connectionId, setConnectionId] = useState<string>(initialData?.connectionId ?? '');
  const [items, setItems] = useState<DraftItem[]>(
    initialData?.items.map((i) => ({
      label: i.label,
      command: i.command,
      expectedOutput: i.expectedOutput ?? '',
      timeoutMs: i.timeoutMs,
    })) ?? [{ label: '', command: '', expectedOutput: '', timeoutMs: 10000 }],
  );

  const addItem = () =>
    setItems((prev) => [...prev, { label: '', command: '', expectedOutput: '', timeoutMs: 10000 }]);

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      connectionId: connectionId || undefined,
      items: items
        .filter((i) => i.label.trim() && i.command.trim())
        .map((i) => ({
          label: i.label.trim(),
          command: i.command.trim(),
          expectedOutput: i.expectedOutput.trim() || undefined,
          timeoutMs: i.timeoutMs,
        })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {initialData ? 'Edit Command Set' : 'New Command Set'}
          </h2>
          <button onClick={onCancel} className="btn-icon !p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {/* Name */}
          <div>
            <label className="form-label">Name</label>
            <input
              autoFocus
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Deploy Pipeline"
              required
            />
          </div>

          {/* Connection (optional) */}
          <div>
            <label className="form-label">Connection (optional)</label>
            <select
              className="form-input"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
            >
              <option value="">Global (all sessions)</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.host})
                </option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="form-label !mb-0">Commands</label>
              <button type="button" onClick={addItem} className="btn-icon !p-1">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2"
                >
                  <div className="flex gap-2">
                    <input
                      className="form-input flex-1 !text-xs"
                      placeholder="Label (e.g. Restart Nginx)"
                      value={item.label}
                      onChange={(e) => updateItem(idx, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="btn-icon !p-1 text-destructive/60 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    className="form-input !text-xs font-mono"
                    placeholder="Command (e.g. sudo systemctl restart nginx)"
                    value={item.command}
                    onChange={(e) => updateItem(idx, { command: e.target.value })}
                  />
                  <input
                    className="form-input !text-xs"
                    placeholder="Expected output (regex/text, optional)"
                    value={item.expectedOutput}
                    onChange={(e) => updateItem(idx, { expectedOutput: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" className="btn-primary text-xs" disabled={!name.trim()}>
              {initialData ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Step 2: Verify TypeScript compiles

```bash
npm run typecheck
```

### Step 3: Commit

```bash
git add src/renderer/src/components/command-sets/CommandSetForm.tsx
git commit -m "feat(command-sets): add CommandSetForm create/edit modal"
```

---

## Task 8: CommandSetsPanel (sidebar section)

**Files:**

- Create: `src/renderer/src/components/command-sets/CommandSetsPanel.tsx`

### Step 1: Create the panel component

Create `src/renderer/src/components/command-sets/CommandSetsPanel.tsx`:

```tsx
import { memo, useState } from 'react';
import { ChevronDown, Pencil, Play, Plus, Terminal, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTerminalStore } from '@/stores/terminal-store';
import { useConnections } from '@/hooks/use-connections';
import {
  useCommandSets,
  useCreateCommandSet,
  useDeleteCommandSet,
  useUpdateCommandSet,
} from '@/hooks/use-command-sets';
import { runCommandSetSequence, type ItemStatus } from '@/lib/command-set-runner';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CommandSetForm } from './CommandSetForm';
import type { CommandSet, CommandSetItem, CreateCommandSetInput } from '@shared/types/command-set';

// ─── CommandSetItemRow ────────────────────────────────────────────────────────

const CommandSetItemRow = memo(function CommandSetItemRow({
  item,
  status,
  disabled,
  onRun,
}: {
  item: CommandSetItem;
  status: ItemStatus;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <button
      onClick={onRun}
      disabled={disabled}
      title={disabled ? 'No active session' : `Send: ${item.command}`}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-sidebar-accent/60 cursor-pointer',
      )}
    >
      {/* Status icon */}
      <span className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
        {status === 'running' && (
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        )}
        {status === 'success' && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
        {status === 'failed' && <span className="h-2 w-2 rounded-full bg-destructive" />}
        {status === 'idle' && (
          <Terminal className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
        )}
      </span>
      <span className="flex-1 truncate text-[12px] text-sidebar-foreground/80">{item.label}</span>
    </button>
  );
});

// ─── CommandSetGroup ──────────────────────────────────────────────────────────

function CommandSetGroup({
  set,
  activeSessionId,
  onEdit,
  onDelete,
}: {
  set: CommandSet;
  activeSessionId: string | null;
  onEdit: (set: CommandSet) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [itemStatuses, setItemStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [running, setRunning] = useState(false);

  const disabled = !activeSessionId;

  const resetStatuses = () => setItemStatuses(new Map());

  const handleRunSingle = (item: CommandSetItem) => {
    if (!activeSessionId) return;
    resetStatuses();
    window.api.ssh.sendData({ sessionId: activeSessionId, data: item.command + '\n' });
  };

  const handleRunAll = () => {
    if (!activeSessionId || running) return;
    resetStatuses();
    setRunning(true);

    runCommandSetSequence(set.items, activeSessionId, {
      onItemStart: (id) => setItemStatuses((prev) => new Map(prev).set(id, 'running')),
      onItemSuccess: (id) => setItemStatuses((prev) => new Map(prev).set(id, 'success')),
      onItemFailed: (id, reason) => {
        setItemStatuses((prev) => new Map(prev).set(id, 'failed'));
        toast.error(`"${set.items.find((i) => i.id === id)?.label}" failed: ${reason}`);
        setRunning(false);
      },
      onComplete: () => {
        toast.success(`"${set.name}" completed`);
        setRunning(false);
      },
    });
  };

  const contextMenuItems: ContextMenuItem[] = [
    {
      label: 'Edit',
      icon: <Pencil className="h-3.5 w-3.5" />,
      onClick: () => onEdit(set),
    },
    {
      label: 'Delete',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => onDelete(set.id),
      destructive: true,
      separator: true,
    },
  ];

  return (
    <ContextMenu items={contextMenuItems}>
      <div>
        {/* Set header */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/40 transition-colors"
        >
          <ChevronDown
            className={cn(
              'h-3 w-3 flex-shrink-0 text-muted-foreground/60 transition-transform duration-150',
              !open && '-rotate-90',
            )}
          />
          <Zap className="h-3 w-3 flex-shrink-0 text-muted-foreground/60" />
          <span className="flex-1 truncate text-[12px] font-medium text-sidebar-foreground/90">
            {set.name}
          </span>
          {set.connectionId && (
            <span className="flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-medium bg-sidebar-primary/10 text-sidebar-primary/70">
              linked
            </span>
          )}
          <span className="flex-shrink-0 text-[10px] text-muted-foreground/40">
            {set.items.length}
          </span>
        </button>

        {/* Items */}
        {open && set.items.length > 0 && (
          <div className="ml-2 border-l border-border/40 pl-1 space-y-0.5 pb-1">
            {set.items.map((item) => (
              <CommandSetItemRow
                key={item.id}
                item={item}
                status={itemStatuses.get(item.id) ?? 'idle'}
                disabled={disabled}
                onRun={() => handleRunSingle(item)}
              />
            ))}

            {/* Run All button */}
            {set.items.length > 1 && (
              <button
                onClick={handleRunAll}
                disabled={disabled || running}
                className={cn(
                  'mt-1 flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium transition-colors',
                  disabled || running
                    ? 'cursor-not-allowed opacity-40 bg-transparent'
                    : 'bg-sidebar-primary/10 text-sidebar-primary hover:bg-sidebar-primary/20',
                )}
              >
                <Play className="h-3 w-3" />
                {running ? 'Running…' : 'Run All'}
              </button>
            )}
          </div>
        )}
      </div>
    </ContextMenu>
  );
}

// ─── CommandSetsPanel ─────────────────────────────────────────────────────────

export const CommandSetsPanel = memo(function CommandSetsPanel() {
  const { data: sets = [], isLoading } = useCommandSets();
  const { data: connections = [] } = useConnections();
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const sessions = useTerminalStore((s) => s.sessions);

  const createMutation = useCreateCommandSet();
  const updateMutation = useUpdateCommandSet();
  const deleteMutation = useDeleteCommandSet();

  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<CommandSet | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Determine the active session's connectionId for filtering linked sets
  const activeConnectionId = activeTabId ? sessions.get(activeTabId)?.connectionId : null;

  // Visible sets: global ones always shown + sets linked to the active connection
  const visibleSets = sets.filter((s) => !s.connectionId || s.connectionId === activeConnectionId);

  const handleSubmit = (input: CreateCommandSetInput) => {
    if (editTarget) {
      updateMutation.mutate(
        {
          id: editTarget.id,
          name: input.name,
          items: input.items.map((i, idx) => ({ ...i, sortOrder: idx })),
        },
        {
          onSuccess: () => toast.success('Command set updated'),
          onError: () => toast.error('Failed to update command set'),
        },
      );
    } else {
      createMutation.mutate(input, {
        onSuccess: () => toast.success('Command set created'),
        onError: () => toast.error('Failed to create command set'),
      });
    }
    setShowForm(false);
    setEditTarget(null);
  };

  if (isLoading) return null;

  return (
    <>
      <div className="border-t border-border/60 px-1.5 pb-1.5 pt-1">
        {/* Section header */}
        <div className="flex items-center gap-1 px-1 py-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex flex-1 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform duration-150', !open && '-rotate-90')}
            />
            <Zap className="h-3 w-3" />
            <span>Command Sets</span>
          </button>
          <button
            onClick={() => {
              setEditTarget(null);
              setShowForm(true);
            }}
            className="btn-icon !p-1"
            title="New command set"
            aria-label="New command set"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Sets list */}
        {open && (
          <div className="space-y-0.5">
            {visibleSets.length === 0 ? (
              <p className="px-2 py-2 text-center text-[11px] text-muted-foreground/50">
                No command sets yet
              </p>
            ) : (
              visibleSets.map((set) => (
                <CommandSetGroup
                  key={set.id}
                  set={set}
                  activeSessionId={activeTabId}
                  onEdit={(s) => {
                    setEditTarget(s);
                    setShowForm(true);
                  }}
                  onDelete={(id) => setConfirmDeleteId(id)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <CommandSetForm
          connections={connections}
          initialData={editTarget ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditTarget(null);
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title="Delete command set?"
        message="This command set and all its commands will be permanently deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (!confirmDeleteId) return;
          deleteMutation.mutate(confirmDeleteId, {
            onSuccess: () => toast.success('Command set deleted'),
            onError: () => toast.error('Failed to delete command set'),
          });
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
});
```

### Step 2: Verify TypeScript compiles

```bash
npm run typecheck
```

### Step 3: Commit

```bash
git add src/renderer/src/components/command-sets/CommandSetsPanel.tsx
git commit -m "feat(command-sets): add CommandSetsPanel, CommandSetGroup, CommandSetItemRow components"
```

---

## Task 9: Wire CommandSetsPanel into Sidebar

**Files:**

- Modify: `src/renderer/src/components/layout/Sidebar.tsx`

### Step 1: Add import

In `src/renderer/src/components/layout/Sidebar.tsx`, add to the imports:

```ts
import { CommandSetsPanel } from '@/components/command-sets/CommandSetsPanel';
```

### Step 2: Mount the panel

In `Sidebar.tsx`, find the closing of the `{/* Connection List */}` scrollable div (around line 234, just before `{/* Settings */}`):

```tsx
          </div>

          {/* Settings */}
```

Replace with:

```tsx
          </div>

          {/* Command Sets */}
          <CommandSetsPanel />

          {/* Settings */}
```

### Step 3: Verify TypeScript compiles and run the app

```bash
npm run typecheck
npm run dev
```

Open the app, check that:

- The "COMMAND SETS" section appears above Settings in the sidebar
- Creating a command set via [+] opens the form and saves successfully
- Click on a command item sends it to the active terminal (verify in xterm)
- "Run All" executes items in sequence; a mismatch on expectedOutput shows an error toast

### Step 4: Commit

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(command-sets): integrate CommandSetsPanel into sidebar"
```

---

## Done

All tasks complete. The feature is fully implemented end-to-end:

1. DB schema with two new tables
2. IPC layer (main process CRUD)
3. Preload bridge
4. React Query hooks
5. Sequential execution engine with output matching
6. Create/edit modal form
7. Sidebar section with per-item run + Run All
8. Linked sets visible only when matching session is active
