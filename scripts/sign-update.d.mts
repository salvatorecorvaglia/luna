/** Exact bytes signed for a macOS update; mirrors updateSignatureMessage() in the app. */
export function buildMessage(version: string, fileName: string, sha512: string): Buffer;
