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
