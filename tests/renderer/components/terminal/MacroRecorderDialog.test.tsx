// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MacroRecorderDialog } from '../../../../src/renderer/src/components/terminal/MacroRecorderDialog';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

beforeEach(() => {
  localStorage.clear();
});

describe('MacroRecorderDialog', () => {
  it('renders nothing when closed', () => {
    render(<MacroRecorderDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Terminal Macro Recorder')).toBeNull();
  });

  it('shows the empty state with no saved macros', () => {
    render(<MacroRecorderDialog open onClose={vi.fn()} />);
    expect(screen.getByText('No macros recorded')).toBeTruthy();
  });

  it('records steps and saves a macro to localStorage', () => {
    render(<MacroRecorderDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Record Macro/ }));
    const input = screen.getByPlaceholderText(/Type command step/);
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Step' }));
    fireEvent.change(screen.getByPlaceholderText(/Macro Name/), {
      target: { value: 'List files' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Finish/ }));

    expect(screen.getByText('List files')).toBeTruthy();
    expect(screen.getByText('ls -la')).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem('luna_terminal_macros') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].sequence).toEqual(['ls -la']);
  });

  it('replays a saved macro via onRunMacro and closes', () => {
    localStorage.setItem(
      'luna_terminal_macros',
      JSON.stringify([{ id: 'm1', name: 'Deploy', sequence: ['git pull'], createdAt: 0 }]),
    );
    const onRunMacro = vi.fn();
    const onClose = vi.fn();
    render(<MacroRecorderDialog open onClose={onClose} onRunMacro={onRunMacro} />);

    fireEvent.click(screen.getByRole('button', { name: /Replay/ }));

    expect(onRunMacro).toHaveBeenCalledWith(['git pull']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('deletes a saved macro', () => {
    localStorage.setItem(
      'luna_terminal_macros',
      JSON.stringify([{ id: 'm1', name: 'Deploy', sequence: ['git pull'], createdAt: 0 }]),
    );
    render(<MacroRecorderDialog open onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Delete Macro'));

    expect(screen.queryByText('Deploy')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('luna_terminal_macros') || '[]');
    expect(stored).toHaveLength(0);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<MacroRecorderDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
