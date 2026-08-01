import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Subscribes to auto-update IPC events and displays toast notifications.
 * Mount this once at the app level so update events are always captured.
 */
export function useUpdaterEventListener(): void {
  useEffect(() => {
    const cleanupAvailable = window.api.app.onUpdateAvailable(({ version }) => {
      toast.info(`Update v${version} available`, {
        description: 'A new version is ready to download.',
        duration: Infinity,
        id: 'update-available',
        action: {
          label: 'Download',
          onClick: () => {
            void window.api.app.installUpdate();
            toast.loading('Downloading update…', {
              id: 'update-progress',
              duration: Infinity,
            });
          },
        },
      });
    });

    const cleanupProgress = window.api.app.onUpdateDownloadProgress(({ percent }) => {
      toast.loading(`Downloading update… ${Math.round(percent)}%`, {
        id: 'update-progress',
        duration: Infinity,
      });
    });

    const cleanupDownloaded = window.api.app.onUpdateDownloaded(() => {
      toast.dismiss('update-progress');
      toast.success('Update downloaded', {
        description: 'Luna will update when you restart the app.',
        duration: Infinity,
        id: 'update-downloaded',
        action: {
          label: 'Restart now',
          onClick: () => {
            void window.api.app.installUpdate();
          },
        },
      });
    });

    const cleanupError = window.api.app.onUpdateError(({ error }) => {
      toast.dismiss('update-progress');
      toast.error('Update failed', {
        description: error,
        id: 'update-error',
        action: {
          label: 'Download manually',
          onClick: () => {
            window.open('https://salvatorecorvaglia.github.io/luna/#download', '_blank');
          },
        },
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
