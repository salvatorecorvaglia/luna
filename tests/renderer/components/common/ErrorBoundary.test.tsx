// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../../../src/renderer/src/components/common/ErrorBoundary';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../../../../src/renderer/src/lib/logger', () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let shouldThrow = true;
function Flaky(): React.ReactNode {
  if (shouldThrow) throw new Error('file list exploded');
  return <p>file list</p>;
}

beforeEach(() => {
  shouldThrow = true;
  logError.mockClear();
  // React logs the caught error itself; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('contains a crash to its view and offers to retry just that view', () => {
    render(
      <ErrorBoundary viewName="File browser">
        <Flaky />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('File browser stopped responding');
    expect(screen.getByText('file list exploded')).toBeInTheDocument();
    expect(screen.getByText('Your other sessions are unaffected.')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('file list')).toBeInTheDocument();
  });

  it('forwards the crash to the main-process log with the view name', () => {
    render(
      <ErrorBoundary viewName="File browser">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(logError).toHaveBeenCalledWith(
      '[ErrorBoundary] renderer crash',
      expect.objectContaining({ view: 'File browser', message: 'file list exploded' }),
    );
  });

  it('falls back to a full reload at the root, where no healthy tree is left', () => {
    const reload = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    });
    try {
      render(
        <ErrorBoundary>
          <Flaky />
        </ErrorBoundary>,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
    }
  });
});
