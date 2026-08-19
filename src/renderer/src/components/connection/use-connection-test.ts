import { useCallback, useEffect, useRef, useState } from 'react';
import { getApi } from '@/services/api';
import type { S3State, SftpState } from './use-connection-form-state';

/**
 * Hard ceiling on a single test run. The main-side handler already times out
 * the SSH connect at LIMITS.SSH_CONNECT_TIMEOUT_MS (60s), but if the IPC
 * itself stalls (main crash, paused renderer-host link) the button would
 * otherwise stay stuck on "Testing…" forever. 65s gives the server a clean
 * grace window without leaving the user waiting indefinitely.
 */
const TEST_HARD_TIMEOUT_MS = 65_000;

export interface TestResult {
  status: 'success' | 'error';
  message: string;
}

export interface RunTestArgs {
  provider: 'sftp' | 's3';
  sftp: SftpState;
  s3: S3State;
  /** Set when editing an existing connection — enables the stored-credential path. */
  editingConnectionId: string | null;
  isEditing: boolean;
}

export interface UseConnectionTestApi {
  testing: boolean;
  result: TestResult | null;
  clearResult(): void;
  /** Start a run, or cancel the one in flight if called again while running. */
  runTest(args: RunTestArgs): Promise<void>;
}

/**
 * Test-connection lifecycle for the connection form.
 *
 * Pulled out of `ConnectionForm` because it is genuinely separate machinery:
 * a run id, an AbortController, a watchdog timer, and three places that must
 * agree on whether the result they're holding is still the current one. Mixed
 * into a 900-line component it was easy to read as "some async state", and
 * hard to see that every `setTestResult` needs the `isStillCurrent` guard —
 * without it, a slow first run overwrites the result of a fast second one.
 */
export function useConnectionTest(): UseConnectionTestApi {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const runRef = useRef<{ controller: AbortController; runId: number } | null>(null);
  const runCounter = useRef(0);

  // Abort any in-flight run on unmount so a late resolution can't call
  // setState on a torn-down component.
  useEffect(() => {
    return () => {
      runRef.current?.controller.abort();
      runRef.current = null;
    };
  }, []);

  const clearResult = useCallback(() => setResult(null), []);

  const cancel = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.controller.abort();
    runRef.current = null;
    setTesting(false);
    setResult(null);
  }, []);

  const runTest = useCallback(
    async (args: RunTestArgs) => {
      // Second press while a run is in flight means "cancel", not "start again".
      if (runRef.current) {
        cancel();
        return;
      }
      // Clear any stale result so the panel doesn't show a misleading prior
      // success while a fresh run is in flight.
      setResult(null);

      const runId = ++runCounter.current;
      const controller = new AbortController();
      runRef.current = { controller, runId };

      const watchdog = setTimeout(() => {
        if (runRef.current?.runId !== runId) return;
        controller.abort();
        runRef.current = null;
        setTesting(false);
        setResult({ status: 'error', message: 'Test timed out — main process not responding' });
      }, TEST_HARD_TIMEOUT_MS);
      controller.signal.addEventListener('abort', () => clearTimeout(watchdog), { once: true });

      /** A newer run (or a cancel) invalidates whatever this one is about to report. */
      const isStillCurrent = (): boolean =>
        runRef.current?.runId === runId && !controller.signal.aborted;

      const finish = (): void => {
        clearTimeout(watchdog);
        if (runRef.current?.runId === runId) {
          runRef.current = null;
          setTesting(false);
        }
      };

      /** Reject before starting: no run was ever in flight, so just clear the slot. */
      const rejectUpfront = (message: string): void => {
        setResult({ status: 'error', message });
        clearTimeout(watchdog);
        runRef.current = null;
      };

      const { provider, sftp, s3, editingConnectionId, isEditing } = args;

      if (provider === 'sftp') {
        if (!sftp.host.trim() || !sftp.username.trim()) {
          rejectUpfront('Host and Username are required to test');
          return;
        }
        setTesting(true);
        try {
          const res = await getApi().ssh.testConnection({
            config: {
              host: sftp.host.trim(),
              port: parseInt(sftp.port) || 22,
              username: sftp.username.trim(),
              authType: sftp.authType,
              privateKeyPath: sftp.privateKeyPath || undefined,
              password: sftp.password || undefined,
              passphrase: sftp.passphrase || undefined,
              keepaliveInterval: (parseInt(sftp.keepaliveInterval) || 10) * 1000,
              keepaliveCountMax: parseInt(sftp.keepaliveCountMax) || 3,
            },
          });
          if (!isStillCurrent()) return;
          setResult(
            res.ok
              ? { status: 'success', message: 'Connection successful' }
              : { status: 'error', message: res.error || 'Connection failed' },
          );
        } catch (err) {
          if (isStillCurrent()) {
            setResult({
              status: 'error',
              message: err instanceof Error ? err.message : 'Connection test failed',
            });
          }
        } finally {
          finish();
        }
        return;
      }

      // S3. With no keys typed while editing, fall back to the stored credential
      // rather than forcing the user to re-enter a secret just to test.
      const useStored = isEditing && !s3.accessKeyId.trim() && !s3.secretAccessKey.trim();
      if (!useStored && (!s3.accessKeyId.trim() || !s3.secretAccessKey.trim())) {
        rejectUpfront('Access Key ID and Secret Access Key are required to test');
        return;
      }
      setTesting(true);
      try {
        const res = await getApi().s3.testConnection(
          useStored
            ? { connectionId: editingConnectionId || undefined }
            : {
                config: {
                  endpoint: s3.host.trim()
                    ? `${s3.protocol}://${s3.host.trim()}${s3.port.trim() ? `:${s3.port.trim()}` : ''}`
                    : undefined,
                  region: s3.region.trim() || undefined,
                  forcePathStyle: s3.forcePathStyle,
                  accessKeyId: s3.accessKeyId.trim(),
                  secretAccessKey: s3.secretAccessKey,
                  sessionToken: s3.sessionToken || undefined,
                  defaultBucket: s3.defaultBucket.trim() || undefined,
                },
              },
        );
        if (!isStillCurrent()) return;
        setResult(
          res.ok
            ? { status: 'success', message: 'S3 connection successful' }
            : { status: 'error', message: res.error || 'S3 connection failed' },
        );
      } catch (err) {
        if (isStillCurrent()) {
          setResult({
            status: 'error',
            message: err instanceof Error ? err.message : 'S3 connection test failed',
          });
        }
      } finally {
        finish();
      }
    },
    [cancel],
  );

  return { testing, result, clearResult, runTest };
}
