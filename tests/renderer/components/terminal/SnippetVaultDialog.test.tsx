// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// AnimatePresence keeps the exiting node mounted mid-transition, which jsdom
// never advances past on its own — irrelevant to this test's assertions, so
// stripped for speed and to avoid unrelated act() warnings.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    // biome-ignore lint/suspicious/noExplicitAny: test-only prop passthrough
    div: ({ initial, animate, exit, transition, variants, children, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
  },
}));

import { SnippetVaultDialog } from '../../../../src/renderer/src/components/terminal/SnippetVaultDialog';

let api: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  api = installFakeApi();
});

describe('SnippetVaultDialog — multi-variable run form', () => {
  // Regression for UX-5: every input in the variables .map() previously got
  // autoFocus, so each subsequent mount stole focus from the last — only the
  // last-rendered field ended up focused instead of the first.
  it('focuses only the first variable field, not the last', async () => {
    (api.snippets.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 's1',
        title: 'Deploy',
        command: 'deploy --env {{env}} --tag {{tag}} --region {{region}}',
        tags: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);

    render(<SnippetVaultDialog open onClose={vi.fn()} />);

    const runButton = await screen.findByTitle('Execute snippet');
    fireEvent.click(runButton);

    await waitFor(() => expect(screen.getByLabelText('{{ env }}')).toBeTruthy());

    const envInput = screen.getByLabelText('{{ env }}') as HTMLInputElement;
    const tagInput = screen.getByLabelText('{{ tag }}') as HTMLInputElement;
    const regionInput = screen.getByLabelText('{{ region }}') as HTMLInputElement;

    expect(document.activeElement).toBe(envInput);
    expect(document.activeElement).not.toBe(tagInput);
    expect(document.activeElement).not.toBe(regionInput);
  });

  it('focuses the sole field when a snippet has exactly one variable', async () => {
    (api.snippets.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 's1',
        title: 'Ping',
        command: 'ping {{host}}',
        tags: [],
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    render(<SnippetVaultDialog open onClose={vi.fn()} />);

    const runButton = await screen.findByTitle('Execute snippet');
    fireEvent.click(runButton);

    await waitFor(() => expect(screen.getByLabelText('{{ host }}')).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByLabelText('{{ host }}'));
  });
});
