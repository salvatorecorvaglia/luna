import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STARTUP_UPDATE_CHECK_DELAY_MS,
  scheduleStartupUpdateCheck,
} from '../../../src/main/lib/startup-update-check';

describe('scheduleStartupUpdateCheck', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancels a pending update check', () => {
    const check = vi.fn();
    const cancel = scheduleStartupUpdateCheck(check);

    cancel();
    vi.advanceTimersByTime(STARTUP_UPDATE_CHECK_DELAY_MS);

    expect(check).not.toHaveBeenCalled();
  });

  it('returns a safe cancel function when automatic checks are disabled', () => {
    const check = vi.fn();
    const cancel = scheduleStartupUpdateCheck(check, { disabled: true });

    expect(vi.getTimerCount()).toBe(0);
    cancel();
    expect(check).not.toHaveBeenCalled();
  });
});
