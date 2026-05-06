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
