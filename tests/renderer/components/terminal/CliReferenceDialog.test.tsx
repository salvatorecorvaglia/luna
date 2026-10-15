// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliReferenceDialog } from '../../../../src/renderer/src/components/terminal/CliReferenceDialog';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const DOC = {
  name: 'tar',
  category: 'archive',
  summary: 'Archive utility',
  syntax: 'tar [options] files',
  examples: [{ description: 'Extract', command: 'tar -xzf file.tar.gz' }],
};

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
  (api.shell.cliReference as ReturnType<typeof vi.fn>).mockResolvedValue([DOC]);
});

describe('CliReferenceDialog', () => {
  it('renders nothing when closed', () => {
    render(<CliReferenceDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Offline CLI Reference & Syntax Helper')).toBeNull();
  });

  it('loads and displays matching docs when open', async () => {
    render(<CliReferenceDialog open onClose={vi.fn()} />);
    // Debounced, so the first query runs a beat after opening.
    await vi.waitFor(() => expect(api.shell.cliReference).toHaveBeenCalledWith(''));
    await screen.findByText('tar');
    expect(screen.getByText('tar -xzf file.tar.gz')).toBeInTheDocument();
  });

  it('re-queries as the search text changes', async () => {
    render(<CliReferenceDialog open onClose={vi.fn()} />);
    await screen.findByText('tar');

    fireEvent.change(screen.getByPlaceholderText(/Search command/), {
      target: { value: 'docker' },
    });

    await vi.waitFor(() => expect(api.shell.cliReference).toHaveBeenCalledWith('docker'));
  });

  it('never lets an older query overwrite the results of a newer one', async () => {
    // Regression: every keystroke fetched with no guard, so a slow response
    // for an earlier query could land last and replace the current results.
    const cli = api.shell.cliReference as ReturnType<typeof vi.fn>;
    let resolveOld!: (v: unknown) => void;
    cli.mockImplementation((q: string) =>
      q === 'old'
        ? new Promise((r) => {
            resolveOld = r;
          })
        : Promise.resolve([{ name: 'docker', description: 'd', category: 'c', examples: [] }]),
    );
    render(<CliReferenceDialog open onClose={vi.fn()} />);
    const box = screen.getByPlaceholderText(/Search command/);
    fireEvent.change(box, { target: { value: 'old' } });
    await vi.waitFor(() => expect(cli).toHaveBeenCalledWith('old'));
    fireEvent.change(box, { target: { value: 'new' } });
    await screen.findByText('docker');

    resolveOld([{ name: 'stale-cmd', description: 's', category: 'c', examples: [] }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('stale-cmd')).toBeNull();
    expect(screen.getByText('docker')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CliReferenceDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the example command to the terminal and closes when onRunCommand is provided', async () => {
    const onRunCommand = vi.fn();
    const onClose = vi.fn();
    render(<CliReferenceDialog open onClose={onClose} onRunCommand={onRunCommand} />);
    await screen.findByText('tar');

    fireEvent.click(screen.getByRole('button', { name: /Run/ }));

    expect(onRunCommand).toHaveBeenCalledWith('tar -xzf file.tar.gz');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
