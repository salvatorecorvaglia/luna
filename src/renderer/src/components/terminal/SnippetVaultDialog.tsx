import type { Snippet } from '@shared/types/snippet';
import { Code, Edit3, Play, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { EmptyState, Spinner } from '@/components/ui';
import { Z } from '@/lib/z-layers';
import { getApi } from '@/services/api';

interface SnippetVaultDialogProps {
  open: boolean;
  onClose: () => void;
  onRunSnippet?: (command: string) => void;
}

function extractVariables(command: string): string[] {
  const matches = command.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.slice(2, -2).trim())));
}

export function SnippetVaultDialog({ open, onClose, onRunSnippet }: SnippetVaultDialogProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Form state for creating/editing
  const [editingSnippet, setEditingSnippet] = useState<Partial<Snippet> | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formTags, setFormTags] = useState('');

  // Variable parameter prompt modal state
  const [promptSnippet, setPromptSnippet] = useState<Snippet | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const fetchSnippets = useCallback(async () => {
    try {
      const list = await getApi().snippets.list();
      setSnippets(list);
    } catch (err) {
      console.error('Failed to load snippets:', err);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchSnippets().finally(() => setLoading(false));
  }, [open, fetchSnippets]);

  const filteredSnippets = snippets.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.tags && s.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))),
  );

  const handleOpenForm = (snippet?: Snippet) => {
    if (snippet) {
      setEditingSnippet(snippet);
      setFormTitle(snippet.title);
      setFormCommand(snippet.command);
      setFormTags(snippet.tags ? snippet.tags.join(', ') : '');
    } else {
      setEditingSnippet({});
      setFormTitle('');
      setFormCommand('');
      setFormTags('');
    }
  };

  const handleSaveSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formCommand.trim()) {
      toast.error('Title and Command are required');
      return;
    }

    const tagsArr = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const varsArr = extractVariables(formCommand);

    try {
      if (editingSnippet?.id) {
        await getApi().snippets.update({
          id: editingSnippet.id,
          title: formTitle,
          command: formCommand,
          tags: tagsArr,
          variables: varsArr,
        });
        toast.success('Snippet updated');
      } else {
        await getApi().snippets.create({
          title: formTitle,
          command: formCommand,
          tags: tagsArr,
          variables: varsArr,
        });
        toast.success('Snippet created');
      }
      setEditingSnippet(null);
      fetchSnippets();
    } catch (err) {
      toast.error(`Failed to save snippet: ${(err as Error).message}`);
    }
  };

  const handleDeleteSnippet = async (id: string) => {
    try {
      await getApi().snippets.delete(id);
      toast.success('Snippet deleted');
      fetchSnippets();
    } catch (err) {
      toast.error(`Failed to delete snippet: ${(err as Error).message}`);
    }
  };

  const handleSelectToRun = (s: Snippet) => {
    const vars = extractVariables(s.command);
    if (vars.length > 0) {
      const initial: Record<string, string> = {};
      for (const v of vars) initial[v] = '';
      setVariableValues(initial);
      setPromptSnippet(s);
    } else {
      executeSnippetCommand(s.command);
    }
  };

  const executeSnippetCommand = (finalCmd: string) => {
    if (onRunSnippet) {
      onRunSnippet(finalCmd);
      toast.success('Snippet executed in terminal');
      onClose();
    } else {
      navigator.clipboard.writeText(finalCmd);
      toast.success('Snippet copied to clipboard');
    }
  };

  const handleConfirmVariables = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptSnippet) return;

    let finalCmd = promptSnippet.command;
    for (const [key, val] of Object.entries(variableValues)) {
      finalCmd = finalCmd.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), val);
    }

    setPromptSnippet(null);
    executeSnippetCommand(finalCmd);
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="snippet-vault-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code className="size-5" />
          </div>
          <div>
            <h2 id="snippet-vault-dialog-title" className="text-base font-semibold">
              Snippet & Script Vault
            </h2>
            <p className="text-xs text-muted-foreground">
              Store, search, and run reusable command scripts with parameter templates
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Search & Add */}
        {!editingSnippet && !promptSnippet && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search snippets by title, command, or tag..."
                className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              onClick={() => handleOpenForm()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              New Snippet
            </button>
          </div>
        )}
        {/* Editing / Creating Form */}
        {editingSnippet && (
          <form
            onSubmit={handleSaveSnippet}
            className="rounded-lg border border-border bg-accent/20 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-semibold">
                {editingSnippet.id ? 'Edit Snippet' : 'New Command Snippet'}
              </span>
              <button
                type="button"
                onClick={() => setEditingSnippet(null)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="snippet-snippet-title" className="block text-muted-foreground mb-1">
                  Snippet Title
                </label>
                <input
                  id="snippet-snippet-title"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Check Docker Container Logs"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="snippet-command-template-use-for-dynamic-prompts"
                  className="block text-muted-foreground mb-1"
                >
                  Command Template (Use <code className="bg-muted px-1 rounded">{'{{param}}'}</code>{' '}
                  for dynamic prompts)
                </label>
                <textarea
                  id="snippet-command-template-use-for-dynamic-prompts"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="docker logs -f --tail 100 {{container_name}}"
                  rows={3}
                  className="w-full font-mono rounded-md border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="snippet-tags-comma-separated"
                  className="block text-muted-foreground mb-1"
                >
                  Tags (comma separated)
                </label>
                <input
                  id="snippet-tags-comma-separated"
                  type="text"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  placeholder="docker, logs, devops"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                Save Snippet
              </button>
            </div>
          </form>
        )}
        {/* Parameter Prompt Form */}
        {promptSnippet && (
          <form
            onSubmit={handleConfirmVariables}
            className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-xs font-semibold">
                Enter Template Parameters for: {promptSnippet.title}
              </span>
              <button
                type="button"
                onClick={() => setPromptSnippet(null)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-2.5">
              {Object.keys(variableValues).map((varKey, i) => (
                <div key={varKey}>
                  {/* Per-key id — this block renders once per variable, so
                          a static id would collide across iterations and every
                          label would point at the first input. */}
                  <label
                    htmlFor={`snippet-var-${varKey}`}
                    className="block text-xs font-mono text-primary mb-1"
                  >
                    {`{{ ${varKey} }}`}
                  </label>
                  <input
                    id={`snippet-var-${varKey}`}
                    type="text"
                    value={variableValues[varKey]}
                    onChange={(e) =>
                      setVariableValues({ ...variableValues, [varKey]: e.target.value })
                    }
                    placeholder={`Enter value for ${varKey}...`}
                    // Only the first field should grab focus — with this
                    // unconditional before, every input in the loop fired
                    // autoFocus on mount and the last one silently won.
                    autoFocus={i === 0}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                <Play className="size-3.5" />
                Run Command
              </button>
            </div>
          </form>
        )}
        {/* List */}
        {!editingSnippet &&
          !promptSnippet &&
          (loading && snippets.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner size="md" label="Loading command snippets…" />
            </div>
          ) : filteredSnippets.length === 0 ? (
            <EmptyState
              icon={<Code />}
              title="No snippets found"
              description="Save frequently executed shell scripts, log tailing commands, or maintenance procedures here for quick access."
              className="rounded-xl border border-dashed border-border bg-accent/10 py-10"
            />
          ) : (
            <div className="space-y-2.5">
              {filteredSnippets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-background p-3.5 shadow-2xs hover:border-primary/40 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">{s.title}</span>
                      {s.tags && s.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {s.tags.map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              <Tag className="size-2.5" />
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="font-mono text-xs text-muted-foreground/90 bg-muted/30 rounded px-2.5 py-1 truncate">
                      {s.command}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleSelectToRun(s)}
                      title="Execute snippet"
                      className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      <Play className="size-3.5" />
                      Run
                    </button>

                    <button
                      onClick={() => handleOpenForm(s)}
                      title="Edit snippet"
                      className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                    >
                      <Edit3 className="size-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteSnippet(s.id)}
                      title="Delete snippet"
                      className="rounded-md border border-destructive/20 bg-destructive/10 p-1.5 text-destructive-fg hover:bg-destructive/20 transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </DialogShell>
  );
}
