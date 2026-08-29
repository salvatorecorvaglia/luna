import { Circle, Play, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DialogShell } from '@/components/common/DialogShell';
import { Z } from '@/lib/z-layers';

interface MacroItem {
  id: string;
  name: string;
  sequence: string[];
  createdAt: number;
}

interface MacroRecorderDialogProps {
  open: boolean;
  onClose: () => void;
  onRunMacro?: (sequence: string[]) => void;
}

const STORAGE_KEY = 'luna_terminal_macros';

export function MacroRecorderDialog({ open, onClose, onRunMacro }: MacroRecorderDialogProps) {
  const [macros, setMacros] = useState<MacroItem[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<string[]>([]);
  const [stepInput, setStepInput] = useState('');
  const [macroName, setMacroName] = useState('');

  const loadMacros = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMacros(JSON.parse(raw));
    } catch {
      // Ignored
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadMacros();
  }, [open, loadMacros]);

  const saveMacros = (newMacros: MacroItem[]) => {
    setMacros(newMacros);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newMacros));
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    setRecordedSteps([]);
    setStepInput('');
    toast.info('Recording started. Add commands step-by-step.');
  };

  const handleAddStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepInput.trim()) return;
    setRecordedSteps((prev) => [...prev, stepInput.trim()]);
    setStepInput('');
  };

  const handleStopAndSave = () => {
    if (recordedSteps.length === 0) {
      toast.error('No steps recorded');
      setIsRecording(false);
      return;
    }

    const name = macroName.trim() || `Macro ${new Date().toLocaleTimeString()}`;
    const newMacro: MacroItem = {
      id: `macro-${Date.now()}`,
      name,
      sequence: recordedSteps,
      createdAt: Date.now(),
    };

    const updated = [newMacro, ...macros];
    saveMacros(updated);
    setIsRecording(false);
    setMacroName('');
    setRecordedSteps([]);
    toast.success(`Saved macro "${name}" with ${recordedSteps.length} step(s)`);
  };

  const handleDeleteMacro = (id: string) => {
    const updated = macros.filter((m) => m.id !== id);
    saveMacros(updated);
    toast.success('Macro deleted');
  };

  const handlePlayMacro = (m: MacroItem) => {
    if (onRunMacro) {
      onRunMacro(m.sequence);
      toast.success(`Replaying macro "${m.name}"`);
      onClose();
    }
  };

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      zLayer={Z.modal}
      dismissOnOverlayClick
      ariaLabelledBy="macro-recorder-dialog-title"
      panelClassName="relative flex flex-col w-full max-w-lg max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Circle className="size-5" />
          </div>
          <div>
            <h2 id="macro-recorder-dialog-title" className="text-base font-semibold">
              Terminal Macro Recorder
            </h2>
            <p className="text-xs text-muted-foreground">
              Record keystroke sequences to replay automated tasks on active shell sessions
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {!isRecording ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Saved Macros ({macros.length})
            </span>

            <button
              type="button"
              onClick={handleStartRecording}
              className="flex items-center gap-1.5 rounded-lg bg-destructive/10 text-destructive-fg border border-destructive/20 px-3 py-1.5 text-xs font-medium hover:bg-destructive/20 transition-colors cursor-pointer"
            >
              <Circle className="size-3 fill-destructive animate-pulse" />
              Record Macro
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-destructive-fg">
                <Circle className="size-3 fill-destructive animate-ping" />
                <span>Recording Macro... ({recordedSteps.length} step(s))</span>
              </div>

              <button
                type="button"
                onClick={() => setIsRecording(false)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleAddStep} className="flex gap-2">
              <input
                type="text"
                value={stepInput}
                onChange={(e) => setStepInput(e.target.value)}
                placeholder="Type command step (e.g. systemctl restart nginx)..."
                autoFocus
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary font-mono"
              />
              <button
                type="submit"
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                Add Step
              </button>
            </form>

            {recordedSteps.length > 0 && (
              <div className="space-y-1 bg-background/60 p-2.5 rounded border border-border/40 font-mono text-2xs max-h-32 overflow-y-auto">
                {recordedSteps.map((step, idx) => (
                  <div key={idx} className="truncate">
                    <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t border-border/40">
              <input
                type="text"
                value={macroName}
                onChange={(e) => setMacroName(e.target.value)}
                placeholder="Macro Name (optional)..."
                className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleStopAndSave}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                <Square className="size-3" />
                Save & Finish
              </button>
            </div>
          </div>
        )}
        {/* List */}
        {!isRecording &&
          (macros.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border rounded-xl bg-accent/10 p-6">
              <Circle className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">No macros recorded</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Click "Record Macro" to record multi-step shell command sequences for automated
                execution.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {macros.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-background p-3.5 shadow-2xs hover:border-primary/40 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-semibold text-foreground">{m.name}</div>
                    <div className="font-mono text-2xs text-muted-foreground truncate">
                      {m.sequence.join(' → ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePlayMacro(m)}
                      title="Replay Macro"
                      className="flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      <Play className="size-3.5" />
                      Replay
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteMacro(m.id)}
                      title="Delete Macro"
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
