import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommandSet, CreateCommandSetInput } from '@shared/types/command-set';
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

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const dialogVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] } },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.1 } },
};

export function CommandSetForm({
  connections,
  initialData,
  onSubmit,
  onCancel,
}: CommandSetFormProps) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [connectionId, setConnectionId] = useState<string>(initialData?.connectionId ?? '');
  const [items, setItems] = useState<DraftItem[]>(
    initialData?.items && initialData.items.length > 0
      ? initialData.items.map((i) => ({
          label: i.label,
          command: i.command,
          expectedOutput: i.expectedOutput ?? '',
          timeoutMs: i.timeoutMs,
        }))
      : [{ label: '', command: '', expectedOutput: '', timeoutMs: 10000 }],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const addItem = () =>
    setItems((prev) => [...prev, { label: '', command: '', expectedOutput: '', timeoutMs: 10000 }]);

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const validItems = items.filter((i) => i.label.trim() && i.command.trim());
    onSubmit({
      name: name.trim(),
      connectionId: connectionId || undefined,
      items: validItems.map((i) => ({
        label: i.label.trim(),
        command: i.command.trim(),
        expectedOutput: i.expectedOutput.trim() || undefined,
        timeoutMs: i.timeoutMs,
      })),
    });
  };

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={onCancel}
        />

        {/* Dialog */}
        <motion.div
          variants={dialogVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="no-drag fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onCancel}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-set-form-title"
            className="no-drag w-full max-w-lg rounded-xl border border-border/80 bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h2 id="command-set-form-title" className="text-sm font-semibold">
                {initialData ? 'Edit Command Set' : 'New Command Set'}
              </h2>
              <button onClick={onCancel} className="btn-icon !p-1" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              {/* Name */}
              <div>
                <label
                  htmlFor="cs-name"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  Name
                </label>
                <input
                  id="cs-name"
                  ref={nameRef}
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Deploy Pipeline"
                  required
                />
              </div>

              {/* Connection (optional) */}
              <div>
                <label
                  htmlFor="cs-connection"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  Connection{' '}
                  <span className="font-normal opacity-60">
                    (optional — leave empty for global)
                  </span>
                </label>
                <select
                  id="cs-connection"
                  className="form-input"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                >
                  <option value="">Global (all sessions)</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.host}
                    </option>
                  ))}
                </select>
              </div>

              {/* Items */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Commands</span>
                  <button
                    type="button"
                    onClick={addItem}
                    className="btn-icon !p-1"
                    aria-label="Add command"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 text-[10px] font-mono text-muted-foreground/40 w-4 text-right">
                          {idx + 1}
                        </span>
                        <input
                          className={cn('form-input flex-1 !text-xs')}
                          placeholder="Label (e.g. Restart Nginx)"
                          value={item.label}
                          onChange={(e) => updateItem(idx, { label: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                          className="btn-icon !p-1 text-destructive/50 hover:text-destructive disabled:opacity-30"
                          aria-label="Remove command"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        className="form-input !text-xs font-mono ml-6"
                        placeholder="Command (e.g. sudo systemctl restart nginx)"
                        value={item.command}
                        onChange={(e) => updateItem(idx, { command: e.target.value })}
                      />
                      <input
                        className="form-input !text-xs ml-6"
                        placeholder="Expected output — regex/text (optional, used for Run All)"
                        value={item.expectedOutput}
                        onChange={(e) => updateItem(idx, { expectedOutput: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
                <button type="button" onClick={onCancel} className="btn-ghost">
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={!name.trim()}>
                  {initialData ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </>
    </AnimatePresence>
  );
}
