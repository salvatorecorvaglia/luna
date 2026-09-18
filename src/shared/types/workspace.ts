export interface WorkspacePreset {
  id: string;
  name: string;
  layout: {
    connectionIds: string[];
    splitDirection?: 'horizontal' | 'vertical';
    activeTabId?: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkspaceInput {
  name: string;
  layout: {
    connectionIds: string[];
    splitDirection?: 'horizontal' | 'vertical';
    activeTabId?: string;
  };
}
