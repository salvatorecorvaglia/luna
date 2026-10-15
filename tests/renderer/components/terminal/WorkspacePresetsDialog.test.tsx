// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePresetsDialog } from '../../../../src/renderer/src/components/terminal/WorkspacePresetsDialog';
import { useTerminalStore } from '../../../../src/renderer/src/stores/terminal-store';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const PRESET = {
  id: 'w1',
  name: 'Prod Cluster',
  layout: { connectionIds: ['c1', 'c2'], activeTabId: undefined },
};

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
  useTerminalStore.setState({ sessions: new Map(), activeSessionId: null });
});

describe('WorkspacePresetsDialog', () => {
  it('renders nothing when closed', () => {
    render(<WorkspacePresetsDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Workspace Layout Presets')).toBeNull();
  });

  it('loads and lists saved presets', async () => {
    (api.workspaces.list as ReturnType<typeof vi.fn>).mockResolvedValue([PRESET]);
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);
    await screen.findByText('Prod Cluster');
    expect(screen.getByText('2 target connection(s) saved')).toBeInTheDocument();
  });

  it('shows the empty state with no saved presets', async () => {
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);
    await screen.findByText('No workspace presets saved');
  });

  it('rejects saving a workspace with no active sessions', () => {
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save Current Layout/ }));
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'Empty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    expect(api.workspaces.create).not.toHaveBeenCalled();
  });

  it('saves the current session set as a new preset', async () => {
    useTerminalStore.setState({
      sessions: new Map([
        [
          'sess-1',
          {
            id: 'sess-1',
            connectionId: 'conn-1',
            connectionName: 'Prod',
            status: 'connected',
            title: 'Prod',
            type: 'ssh',
          },
        ],
      ]),
      activeSessionId: 'sess-1',
    });
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save Current Layout/ }));
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'My Setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    await vi.waitFor(() =>
      expect(api.workspaces.create).toHaveBeenCalledWith({
        name: 'My Setup',
        layout: { connectionIds: ['conn-1'], activeTabId: 'sess-1' },
      }),
    );
  });

  it('saves only live SSH connections — never local shells or dead sessions', async () => {
    // Regression: local shells were saved under the pseudo id 'local', which
    // restore then tried to connect to, producing an error tab.
    const base = { connectionName: 'x', title: 'x' };
    useTerminalStore.setState({
      sessions: new Map([
        ['a', { id: 'a', connectionId: 'conn-a', status: 'connected', type: 'ssh', ...base }],
        ['l', { id: 'l', connectionId: 'local', status: 'connected', type: 'local', ...base }],
        ['d', { id: 'd', connectionId: 'conn-d', status: 'disconnected', type: 'ssh', ...base }],
      ]),
      activeSessionId: 'a',
    });
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Save Current Layout/ }));
    fireEvent.change(screen.getByLabelText('Preset Name'), { target: { value: 'Mixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preset' }));

    await vi.waitFor(() =>
      expect(api.workspaces.create).toHaveBeenCalledWith({
        name: 'Mixed',
        layout: { connectionIds: ['conn-a'], activeTabId: 'a' },
      }),
    );
  });

  it('restores a preset via onRestoreWorkspace and closes', async () => {
    (api.workspaces.list as ReturnType<typeof vi.fn>).mockResolvedValue([PRESET]);
    const onRestoreWorkspace = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspacePresetsDialog open onClose={onClose} onRestoreWorkspace={onRestoreWorkspace} />,
    );
    await screen.findByText('Prod Cluster');

    fireEvent.click(screen.getByRole('button', { name: /Launch/ }));

    expect(onRestoreWorkspace).toHaveBeenCalledWith(PRESET);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<WorkspacePresetsDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspacePresetsDialog — load failure', () => {
  it('shows the error with a retry instead of an empty list', async () => {
    // Regression: a failed load was logged and rendered as "No workspace
    // presets saved", indistinguishable from having none.
    (api.workspaces.list as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce([]);
    render(<WorkspacePresetsDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("Couldn't load workspace presets")).toBeInTheDocument();
    expect(screen.getByText('database is locked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No workspace presets saved')).toBeInTheDocument();
  });
});
