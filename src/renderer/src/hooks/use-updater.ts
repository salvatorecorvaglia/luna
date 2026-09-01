import { useEffect } from 'react';
import { toast } from 'sonner';
import { getApi } from '@/services/api';

/** Sends the user to the GitHub releases page; main owns the URL. */
function openReleasePage(): void {
  getApi()
    .app.openReleasePage()
    .catch(() => toast.error('Could not open the releases page'));
}

/**
 * Subscribes to auto-update IPC events and displays toast notifications.
 * Mount this once at the app level so update events are always captured.
 */
export function useUpdaterEventListener(): void {
  useEffect(() => {
    const cleanupAvailable = getApi().app.onUpdateAvailable(({ version, manual }) => {
      // `manual` builds (an unsigned macOS bundle) cannot install an update
      // themselves — Squirrel rejects the swap. Offering "Download" there ends
      // in a failure the user can do nothing about, so send them to GitHub.
      if (manual) {
        toast.info(`Update v${version} available`, {
          description: 'This build cannot update itself. Download the new version from GitHub.',
          duration: Infinity,
          id: 'update-available',
          action: { label: 'Open GitHub', onClick: openReleasePage },
        });
        return;
      }

      toast.info(`Update v${version} available`, {
        description: 'A new version of Luna is ready to download.',
        duration: Infinity,
        id: 'update-available',
        action: {
          label: 'Download',
          onClick: () => {
            getApi()
              .app.installUpdate()
              .catch(() => {
                toast.dismiss('update-progress');
                toast.error('Failed to start update download');
              });
            toast.loading('Downloading update…', {
              id: 'update-progress',
              duration: Infinity,
            });
          },
        },
      });
    });

    const cleanupProgress = getApi().app.onUpdateDownloadProgress(({ percent }) => {
      toast.loading(`Downloading update… ${Math.round(percent)}%`, {
        id: 'update-progress',
        duration: Infinity,
      });
    });

    const cleanupDownloaded = getApi().app.onUpdateDownloaded(() => {
      toast.dismiss('update-progress');
      toast.success('Update downloaded', {
        description: 'Luna will update when you restart the app.',
        duration: Infinity,
        id: 'update-downloaded',
        action: {
          label: 'Restart now',
          onClick: () => {
            getApi()
              .app.installUpdate()
              .catch(() => toast.error('Failed to restart for update'));
          },
        },
      });
    });

    const cleanupError = getApi().app.onUpdateError(({ error }) => {
      toast.dismiss('update-progress');
      // Every update failure ends the same way — get the build from GitHub —
      // so the error toast always carries a way to act on it.
      toast.error('Update failed', {
        description: error,
        id: 'update-error',
        action: { label: 'Open GitHub', onClick: openReleasePage },
      });
    });

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);
}
