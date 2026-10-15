// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectToS3 } from '../../../src/renderer/src/lib/s3';
import { useStorageStore } from '../../../src/renderer/src/stores/storage-store';
import { useUIStore } from '../../../src/renderer/src/stores/ui-store';
import { installFakeApi } from '../../../src/test/fake-api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('connectToS3', () => {
  let api: ReturnType<typeof installFakeApi>;
  beforeEach(() => {
    api = installFakeApi();
    useStorageStore.setState({ storageSessions: new Map(), activeSessionId: null });
    useUIStore.setState({ activeView: 'terminal' });
  });

  it('opens one session for concurrent calls (double-click)', async () => {
    // Regression: nothing was connected yet, so every call passed the
    // existing-session checks and opened its own S3 session.
    const [a, b] = await Promise.all([connectToS3('c1'), connectToS3('c1')]);
    expect(a).toBe(b);
    expect(api.s3.connect).toHaveBeenCalledTimes(1);
    expect(useStorageStore.getState().storageSessions.size).toBe(1);
  });

  it('switches to the storage view once the new session is up', async () => {
    await connectToS3('c1');
    expect(useUIStore.getState().activeView).toBe('sftp');
  });
});
