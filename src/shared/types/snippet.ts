export interface Snippet {
  id: string;
  title: string;
  command: string;
  tags?: string[];
  variables?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateSnippetInput {
  title: string;
  command: string;
  tags?: string[];
  variables?: string[];
}

export interface UpdateSnippetInput extends Partial<CreateSnippetInput> {
  id: string;
}
