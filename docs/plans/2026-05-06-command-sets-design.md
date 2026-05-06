# Command Sets — Design Document

**Date:** 2026-05-06  
**Status:** Approved  
**Scope:** New feature — sidebar section for grouping and executing shell commands

---

## Overview

Add a **Command Sets** section to the sidebar that lets users define named groups of shell commands (templates) and send them to any active SSH session with a single click. Each set can be global or tied to a specific connection.

---

## Goals

- One-click sending of a single command to the active shell
- Sequential execution of a full template with expected-output validation
- Stop-on-failure with user notification
- Global sets + per-connection sets
- Full CRUD (create, rename, delete, reorder items)

---

## Data Model

### DB Migration `008_command_sets`

```sql
CREATE TABLE IF NOT EXISTS command_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_id TEXT,            -- NULL = global set
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS command_set_items (
  id TEXT PRIMARY KEY,
  command_set_id TEXT NOT NULL REFERENCES command_sets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,           -- human-readable name, e.g. "Restart Nginx"
  command TEXT NOT NULL,         -- raw shell command, e.g. "sudo systemctl restart nginx"
  expected_output TEXT,          -- regex or substring to match in shell output (optional)
  timeout_ms INTEGER DEFAULT 10000,
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

### TypeScript Types (`src/shared/types/command-set.ts`)

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
  items: Omit<CommandSetItem, 'id' | 'commandSetId' | 'sortOrder'>[];
}

export interface UpdateCommandSetInput {
  id: string;
  name?: string;
  items?: Omit<CommandSetItem, 'id' | 'commandSetId'>[];
}
```

---

## IPC Layer

### New constants (`src/shared/constants.ts`)

```ts
COMMAND_SET_LIST:   'command-set:list',
COMMAND_SET_CREATE: 'command-set:create',
COMMAND_SET_UPDATE: 'command-set:update',
COMMAND_SET_DELETE: 'command-set:delete',
```

### New IPC handler (`src/main/ipc/command-set.ipc.ts`)

CRUD operations:

| Handler              | Input                   | Output         |
| -------------------- | ----------------------- | -------------- |
| `COMMAND_SET_LIST`   | —                       | `CommandSet[]` |
| `COMMAND_SET_CREATE` | `CreateCommandSetInput` | `CommandSet`   |
| `COMMAND_SET_UPDATE` | `UpdateCommandSetInput` | `CommandSet`   |
| `COMMAND_SET_DELETE` | `id: string`            | `void`         |

### Preload bridge addition (`src/preload/index.ts`)

```ts
commandSets: {
  list:   ()                          => invoke(IPC.COMMAND_SET_LIST),
  create: (input: CreateCommandSetInput) => invoke(IPC.COMMAND_SET_CREATE, input),
  update: (input: UpdateCommandSetInput) => invoke(IPC.COMMAND_SET_UPDATE, input),
  delete: (id: string)                => invoke(IPC.COMMAND_SET_DELETE, id),
},
```

---

## Sequential Execution Engine

Command execution is handled entirely in the **renderer process**. No new IPC channels are needed; existing `ssh:send-data` and `ssh:on-data` are reused.

### Algorithm

```
runTemplate(items: CommandSetItem[], sessionId: string):
  for each item in items (ordered by sortOrder):
    send: window.api.ssh.sendData({ sessionId, data: item.command + '\n' })
    if item.expectedOutput is set:
      start timer (item.timeoutMs)
      accumulate output from ssh:on-data events for this sessionId
      if output matches expectedOutput (regex test):
        → proceed to next item
      if timeout fires before match:
        → unsubscribe listener
        → toast.error(`Command "${item.label}" failed: expected output not received`)
        → abort remaining items
    else:
      wait fixed 300ms delay, then proceed (fire-and-forget item)
  toast.success("Template completed successfully")
```

### Output matching

`expectedOutput` is tested as a JavaScript `RegExp`. If the string is not valid regex, it falls back to plain `String.includes()` matching.

### Execution state

A local `useState` in `CommandSetGroup` tracks execution state per-item:

```ts
type ItemStatus = 'idle' | 'running' | 'success' | 'failed';
executionState: Map<itemId, ItemStatus>;
```

This is ephemeral UI state (not persisted).

---

## UI Components

### Sidebar layout (updated `Sidebar.tsx`)

```
┌─────────────────────────────┐
│ CONNECTIONS          [+]    │
├─────────────────────────────┤
│ 🔍 Filter connections...    │
├─────────────────────────────┤
│  [Connection list]          │
│  ...                        │
│  ─────────────────────────  │
│  ▾ 🕐 Recent          [N]  │
├─────────────────────────────┤  ← new divider
│  ▾ ⚡ COMMAND SETS   [+]   │  ← collapsible header + new set button
│                             │
│  ▸ Deploy Pipeline          │  ← global set (collapsed)
│  ▾ Nginx                    │  ← expanded set
│    • nginx -t               │  ← clickable item (sends single command)
│    • systemctl restart      │
│    [▶ Run All]              │  ← sequential execution button
├─────────────────────────────┤
│ ⚙ Settings                 │
└─────────────────────────────┘
```

### New components

| Component           | File                                            | Description                                                                                        |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CommandSetsPanel`  | `components/command-sets/CommandSetsPanel.tsx`  | Collapsible section wrapper, header with [+] button, lists all visible sets                        |
| `CommandSetGroup`   | `components/command-sets/CommandSetGroup.tsx`   | Single expandable set: header (name, connection badge), item list, Run All button, execution state |
| `CommandSetItemRow` | `components/command-sets/CommandSetItemRow.tsx` | Single row: label, status icon, click-to-send                                                      |
| `CommandSetForm`    | `components/command-sets/CommandSetForm.tsx`    | Modal/dialog for creating and editing a set and its items (dynamic item list with drag-to-reorder) |

### Visibility logic in `CommandSetsPanel`

- **Global sets**: always shown
- **Connection-specific sets**: shown only when `activeTabId` corresponds to that `connectionId`
- If `activeTabId === null`: items are rendered but visually disabled (grayed, no click handler), with tooltip "No active session"

### Context menus

**On set header (right-click):**

- Rename
- Edit items
- Delete

**On item row (right-click):**

- Edit
- Delete
- Move up / Move down

---

## React Query Hook (`src/renderer/src/hooks/use-command-sets.ts`)

```ts
useCommandSets(); // useQuery(['command-sets'])
useCreateCommandSet(); // useMutation → invalidate ['command-sets']
useUpdateCommandSet(); // useMutation → invalidate ['command-sets']
useDeleteCommandSet(); // useMutation → invalidate ['command-sets']
```

---

## Files to Create / Modify

| Action | File                                                                                |
| ------ | ----------------------------------------------------------------------------------- |
| Modify | `src/main/services/database.ts` — add migration `008_command_sets`                  |
| Create | `src/shared/types/command-set.ts`                                                   |
| Modify | `src/shared/types/ipc.ts` — add command-set entries to `IpcHandlerMap`              |
| Modify | `src/shared/constants.ts` — add 4 IPC constants                                     |
| Create | `src/main/ipc/command-set.ipc.ts`                                                   |
| Modify | `src/main/ipc/index.ts` — register new handlers                                     |
| Modify | `src/preload/index.ts` — expose `window.api.commandSets`                            |
| Create | `src/renderer/src/hooks/use-command-sets.ts`                                        |
| Create | `src/renderer/src/components/command-sets/CommandSetsPanel.tsx`                     |
| Create | `src/renderer/src/components/command-sets/CommandSetGroup.tsx`                      |
| Create | `src/renderer/src/components/command-sets/CommandSetItemRow.tsx`                    |
| Create | `src/renderer/src/components/command-sets/CommandSetForm.tsx`                       |
| Modify | `src/renderer/src/components/layout/Sidebar.tsx` — add `<CommandSetsPanel>` section |

---

## Out of Scope (v1)

- Import/export command sets to/from JSON
- Sharing command sets between users
- Variables/placeholders in commands (e.g. `{{host}}`)
- Nested command sets
