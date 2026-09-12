// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditExportDialog } from '../../../../src/renderer/src/components/terminal/AuditExportDialog';
import {
  __resetTerminalRegistry,
  registerTerminal,
} from '../../../../src/renderer/src/lib/terminal-registry';
import { installFakeApi } from '../../../../src/test/fake-api';

/**
 * Stand-in for the slice of xterm the export reads. Lines are padded to a width
 * the way xterm pads them, so the trailing-whitespace trim is actually exercised
 * rather than assumed.
 */
function fakeTerminal(lines: string[]) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) => {
          const raw = lines[i];
          if (raw === undefined) return undefined;
          return { translateToString: (trimRight?: boolean) => (trimRight ? raw.trimEnd() : raw) };
        },
      },
    },
  };
}

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
  __resetTerminalRegistry();
  registerTerminal('s1', fakeTerminal(['$ whoami     ', 'root        ', '            ']));
});

describe('AuditExportDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <AuditExportDialog open={false} onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />,
    );
    expect(screen.queryByText('Session Audit Trail Exporter')).toBeNull();
  });

  it('shows the active session title and defaults to the HTML format', () => {
    render(<AuditExportDialog open onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />);
    expect(screen.getByText('Prod Box')).toBeTruthy();
    expect(screen.getByRole('button', { name: /HTML/ })).toHaveClass('border-primary');
  });

  it('switches the selected export format on click', () => {
    render(<AuditExportDialog open onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />);
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    expect(screen.getByRole('button', { name: /JSON/ })).toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: /HTML/ })).not.toHaveClass('border-primary');
  });

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn();
    render(<AuditExportDialog open onClose={onClose} sessionId="s1" sessionTitle="Prod Box" />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<AuditExportDialog open onClose={onClose} sessionId="s1" sessionTitle="Prod Box" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing if the save dialog is cancelled', async () => {
    (api.shell.saveFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<AuditExportDialog open onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />);
    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));
    await vi.waitFor(() => expect(api.shell.saveFileDialog).toHaveBeenCalled());
    expect(api.shell.exportAuditLog).not.toHaveBeenCalled();
  });

  it('exports via shell.exportAuditLog with the selected format and closes on success', async () => {
    (api.shell.saveFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/audit.json');
    const onClose = vi.fn();
    render(<AuditExportDialog open onClose={onClose} sessionId="s1" sessionTitle="Prod Box" />);
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));

    await vi.waitFor(() =>
      expect(api.shell.exportAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          sessionTitle: 'Prod Box',
          bufferText: '$ whoami\nroot',
          format: 'json',
          destinationPath: '/tmp/audit.json',
        }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  /**
   * The defect this component shipped with: the transcript was an optional prop
   * defaulting to '', TerminalToolbar passed nothing, and every export wrote a
   * header and no body. Every test above passed bufferText="hello" explicitly,
   * so the suite proved the component worked and never checked that anything
   * fed it. These two cover the wiring instead of the component.
   */
  it('refuses to export when the session has no live terminal', async () => {
    __resetTerminalRegistry(); // session closed, nothing registered
    (api.shell.saveFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/audit.txt');
    render(<AuditExportDialog open onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />);

    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.shell.exportAuditLog).not.toHaveBeenCalled();
    // Critically: no save dialog either. Offering a file picker and then
    // writing an empty document is the exact behaviour being fixed.
    expect(api.shell.saveFileDialog).not.toHaveBeenCalled();
  });

  it('refuses to export an empty transcript', async () => {
    __resetTerminalRegistry();
    registerTerminal('s1', fakeTerminal(['', '   ', '']));
    render(<AuditExportDialog open onClose={vi.fn()} sessionId="s1" sessionTitle="Prod Box" />);

    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.shell.exportAuditLog).not.toHaveBeenCalled();
  });
});
