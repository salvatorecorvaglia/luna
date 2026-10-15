// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../../../src/renderer/src/components/common/ContextMenu';

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  render(
    <ContextMenu
      items={[
        { label: 'Edit', onClick: onEdit },
        { label: 'Duplicate', onClick: vi.fn() },
        { label: 'Delete', onClick: onDelete, destructive: true },
      ]}
    >
      <button type="button">Row</button>
    </ContextMenu>,
  );
  return screen.getByRole('button', { name: 'Row' });
}

/** Menu focus moves on the next animation frame. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  });
}

describe('ContextMenu', () => {
  it('opens under the element when triggered from the keyboard (0,0 coordinates)', async () => {
    // Regression: the Menu key / Shift+F10 report clientX/Y of 0, which put
    // the menu in the window's top-left corner.
    const row = renderMenu();
    row.getBoundingClientRect = () =>
      ({ left: 100, bottom: 200, top: 180, right: 300, width: 200, height: 20 }) as DOMRect;
    row.focus();
    fireEvent.contextMenu(row, { clientX: 0, clientY: 0 });

    const menu = await screen.findByRole('menu');
    expect(menu.style.left).toBe('108px');
    expect(menu.style.top).not.toBe('0px');
  });

  it('supports Home and End', async () => {
    const row = renderMenu();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await screen.findByRole('menu');
    await nextFrame();

    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toHaveTextContent('Delete');
    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toHaveTextContent('Edit');
  });

  it('returns focus to the opener when closed with Escape', async () => {
    const row = renderMenu();
    row.focus();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await screen.findByRole('menu');
    await nextFrame();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.activeElement).toBe(row);
  });

  it('closes when Tab moves focus away', async () => {
    const row = renderMenu();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await screen.findByRole('menu');

    fireEvent.keyDown(document, { key: 'Tab' });

    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
