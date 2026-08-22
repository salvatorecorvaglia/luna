// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdaterEventListener } from '../../../src/renderer/src/hooks/use-updater';

const toastInfo = vi.fn();
const toastLoading = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastDismiss = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...a),
    loading: (...a: unknown[]) => toastLoading(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    dismiss: (...a: unknown[]) => toastDismiss(...a),
  },
}));

// Captured event listeners — exposed so tests can fire events synthetically.
type Handler<T> = (payload: T) => void;
let availableHandler: Handler<{ version: string }> | null = null;
let progressHandler: Handler<{ percent: number }> | null = null;
let downloadedHandler: Handler<unknown> | null = null;
let errorHandler: Handler<{ error: string }> | null = null;

const cleanupAvailable = vi.fn();
const cleanupProgress = vi.fn();
const cleanupDownloaded = vi.fn();
const cleanupError = vi.fn();

const installUpdate = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  toastInfo.mockReset();
  toastLoading.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastDismiss.mockReset();
  cleanupAvailable.mockClear();
  cleanupProgress.mockClear();
  cleanupDownloaded.mockClear();
  cleanupError.mockClear();
  installUpdate.mockClear();
  availableHandler = null;
  progressHandler = null;
  downloadedHandler = null;
  errorHandler = null;
  Object.assign(window, {
    api: {
      app: {
        installUpdate,
        onUpdateAvailable: (cb: typeof availableHandler) => {
          availableHandler = cb;
          return cleanupAvailable;
        },
        onUpdateDownloadProgress: (cb: typeof progressHandler) => {
          progressHandler = cb;
          return cleanupProgress;
        },
        onUpdateDownloaded: (cb: typeof downloadedHandler) => {
          downloadedHandler = cb;
          return cleanupDownloaded;
        },
        onUpdateError: (cb: typeof errorHandler) => {
          errorHandler = cb;
          return cleanupError;
        },
      },
    },
  });
});

describe('useUpdaterEventListener', () => {
  it('subscribes to all four update events on mount', () => {
    renderHook(() => useUpdaterEventListener());
    expect(availableHandler).toBeTruthy();
    expect(progressHandler).toBeTruthy();
    expect(downloadedHandler).toBeTruthy();
    expect(errorHandler).toBeTruthy();
  });

  it('shows an info toast when an update becomes available', () => {
    renderHook(() => useUpdaterEventListener());
    availableHandler?.({ version: '2.0.0' });
    expect(toastInfo).toHaveBeenCalledWith(
      'Update v2.0.0 available',
      expect.objectContaining({ id: 'update-available' }),
    );
  });

  it('shows a loading toast on download progress', () => {
    renderHook(() => useUpdaterEventListener());
    progressHandler?.({ percent: 42.7 });
    expect(toastLoading).toHaveBeenCalledWith(
      'Downloading update… 43%',
      expect.objectContaining({ id: 'update-progress' }),
    );
  });

  it('dismisses progress and shows success when download completes', () => {
    renderHook(() => useUpdaterEventListener());
    downloadedHandler?.({});
    expect(toastDismiss).toHaveBeenCalledWith('update-progress');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Update downloaded',
      expect.objectContaining({ id: 'update-downloaded' }),
    );
  });

  it('dismisses progress and shows error on update failure', () => {
    renderHook(() => useUpdaterEventListener());
    errorHandler?.({ error: 'signature mismatch' });
    expect(toastDismiss).toHaveBeenCalledWith('update-progress');
    expect(toastError).toHaveBeenCalledWith(
      'Update failed',
      expect.objectContaining({ description: 'signature mismatch', id: 'update-error' }),
    );
  });

  it('runs every cleanup function when the component unmounts', () => {
    const { unmount } = renderHook(() => useUpdaterEventListener());
    unmount();
    expect(cleanupAvailable).toHaveBeenCalled();
    expect(cleanupProgress).toHaveBeenCalled();
    expect(cleanupDownloaded).toHaveBeenCalled();
    expect(cleanupError).toHaveBeenCalled();
  });

  it('surfaces a toast when installUpdate fails from the "Download" action', async () => {
    installUpdate.mockRejectedValueOnce(new Error('disk full'));
    renderHook(() => useUpdaterEventListener());
    availableHandler?.({ version: '2.0.0' });

    const onClick = toastInfo.mock.calls[0][1].action.onClick;
    onClick();

    await vi.waitFor(() => {
      expect(toastDismiss).toHaveBeenCalledWith('update-progress');
      expect(toastError).toHaveBeenCalledWith('Failed to start update download');
    });
  });

  it('surfaces a toast when installUpdate fails from the "Restart now" action', async () => {
    installUpdate.mockRejectedValueOnce(new Error('disk full'));
    renderHook(() => useUpdaterEventListener());
    downloadedHandler?.({});

    const onClick = toastSuccess.mock.calls[0][1].action.onClick;
    onClick();

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to restart for update');
    });
  });
});
