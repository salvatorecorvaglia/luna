import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A short-lived "copied!" flag that resets itself.
 *
 * Both `FilePreview` and `HostKeyDialog` had this inline as a bare
 * `setTimeout(() => setCopied(false), 2000)` with no cleanup, so unmounting
 * within the window (closing the dialog right after copying — the common case)
 * left a timer to fire against a dead component. Sharing one hook also stops
 * the two from drifting apart on duration.
 *
 * @param resetAfterMs How long the flag stays true.
 */
export function useCopiedFlag(resetAfterMs = 2000): {
  copied: boolean;
  markCopied: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markCopied = useCallback(() => {
    // Restart rather than stack: copying twice in quick succession should keep
    // the indicator up for the full duration after the *second* copy.
    clear();
    setCopied(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, resetAfterMs);
  }, [clear, resetAfterMs]);

  useEffect(() => clear, [clear]);

  return { copied, markCopied };
}
