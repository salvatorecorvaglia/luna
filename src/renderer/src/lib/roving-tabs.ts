import type React from 'react';

/**
 * Arrow/Home/End navigation for a `role="tablist"`, with selection following
 * focus (as the TitleBar view tabs do). Each tab carries `data-tab-id` and a
 * roving tabIndex (0 on the active tab, -1 elsewhere), so the whole strip is a
 * single Tab stop. The terminal tab strips had `role="tab"` on elements that
 * could not be focused at all, so a keyboard user could not switch tabs
 * without the Cmd+1..9 chords.
 */
export function handleTablistKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  activate: (tabId: string) => void,
): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const tabs = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"][data-tab-id]'),
  );
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (tabs.length === 0 || current === -1) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? tabs.length - 1
        : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const target = tabs[next]!;
  target.focus();
  const id = target.dataset.tabId;
  if (id) activate(id);
}

/** Enter/Space on a focused tab activates it. */
export function handleTabKeyDown(e: React.KeyboardEvent, activate: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    activate();
  }
}
