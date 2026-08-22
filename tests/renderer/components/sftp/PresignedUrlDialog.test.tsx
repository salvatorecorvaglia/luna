// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../../../../src/test/fake-api';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { PresignedUrlDialog } from '../../../../src/renderer/src/components/sftp/PresignedUrlDialog';

const ENTRY = { name: 'file.txt', path: '/remote/file.txt' };

beforeEach(() => {
  installFakeApi();
});

describe('PresignedUrlDialog — backdrop click', () => {
  // Regression for UX-6: the dismiss handler previously sat on the overlay
  // div, but the inset-0 panel wrapper rendered on top of it and intercepted
  // every click first — the handler never actually fired.
  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <PresignedUrlDialog open entry={ENTRY} sessionId="s1" onClose={onClose} />,
    );

    const panel = baseElement.querySelector('.fixed.inset-0.flex') as HTMLElement;
    expect(panel).toBeTruthy();
    fireEvent.click(panel);

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside the dialog card', () => {
    const onClose = vi.fn();
    render(<PresignedUrlDialog open entry={ENTRY} sessionId="s1" onClose={onClose} />);

    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<PresignedUrlDialog open entry={ENTRY} sessionId="s1" onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
