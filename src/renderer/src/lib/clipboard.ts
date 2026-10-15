import { toast } from 'sonner';

/**
 * Copy text and report the outcome honestly. Several call sites toasted
 * "Copied" *before* the write resolved (or without awaiting it at all), so a
 * rejected write — permission denied, no focus — still announced success over
 * an unchanged clipboard. Resolves true only once the text is on the clipboard.
 */
export async function copyToClipboard(text: string, successMessage?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) toast.success(successMessage);
    return true;
  } catch {
    toast.error('Could not copy to the clipboard');
    return false;
  }
}
