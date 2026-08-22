// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditExportDialog } from '../../../../src/renderer/src/components/terminal/AuditExportDialog';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
});

describe('AuditExportDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <AuditExportDialog
        open={false}
        onClose={vi.fn()}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    expect(screen.queryByText('Session Audit Trail Exporter')).toBeNull();
  });

  it('shows the active session title and defaults to the HTML format', () => {
    render(
      <AuditExportDialog
        open
        onClose={vi.fn()}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    expect(screen.getByText('Prod Box')).toBeTruthy();
    expect(screen.getByRole('button', { name: /HTML/ })).toHaveClass('border-primary');
  });

  it('switches the selected export format on click', () => {
    render(
      <AuditExportDialog
        open
        onClose={vi.fn()}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    expect(screen.getByRole('button', { name: /JSON/ })).toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: /HTML/ })).not.toHaveClass('border-primary');
  });

  it('calls onClose from the Cancel button', () => {
    const onClose = vi.fn();
    render(
      <AuditExportDialog
        open
        onClose={onClose}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <AuditExportDialog
        open
        onClose={onClose}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing if the save dialog is cancelled', async () => {
    (api.shell.saveFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(
      <AuditExportDialog
        open
        onClose={vi.fn()}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));
    await vi.waitFor(() => expect(api.shell.saveFileDialog).toHaveBeenCalled());
    expect(api.shell.exportAuditLog).not.toHaveBeenCalled();
  });

  it('exports via shell.exportAuditLog with the selected format and closes on success', async () => {
    (api.shell.saveFileDialog as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/audit.json');
    const onClose = vi.fn();
    render(
      <AuditExportDialog
        open
        onClose={onClose}
        sessionId="s1"
        sessionTitle="Prod Box"
        bufferText="hello"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save Audit File/ }));

    await vi.waitFor(() =>
      expect(api.shell.exportAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 's1',
          sessionTitle: 'Prod Box',
          bufferText: 'hello',
          format: 'json',
          destinationPath: '/tmp/audit.json',
        }),
      ),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
