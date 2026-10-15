import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isUpdateSigningConfigured,
  UPDATE_PUBLIC_KEY_PEM,
  updateSignatureMessage,
  verifyUpdateSignature,
} from '../../../src/main/services/update-signature';

/** Throwaway keypair — never the release key. */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signMessage(message: Buffer, key = privateKey): string {
  return sign(null, message, key).toString('base64');
}

const MESSAGE = updateSignatureMessage('1.6.0', 'luna-1.6.0-mac-arm64.zip', 'digest==');

describe('update-signature', () => {
  it('accepts a signature made by the matching private key', () => {
    expect(verifyUpdateSignature(MESSAGE, signMessage(MESSAGE), PUBLIC_PEM)).toBe(true);
  });

  it('rejects a signature by a different key', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(verifyUpdateSignature(MESSAGE, signMessage(MESSAGE, other), PUBLIC_PEM)).toBe(false);
  });

  it.each([
    ['version', updateSignatureMessage('1.6.1', 'luna-1.6.0-mac-arm64.zip', 'digest==')],
    ['file name', updateSignatureMessage('1.6.0', 'luna-1.6.0-mac-x64.zip', 'digest==')],
    ['digest', updateSignatureMessage('1.6.0', 'luna-1.6.0-mac-arm64.zip', 'other==')],
  ])('rejects a valid signature replayed against a different %s', (_field, other) => {
    expect(verifyUpdateSignature(other, signMessage(MESSAGE), PUBLIC_PEM)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['not base64 of 64 bytes', 'c2hvcnQ='],
    ['garbage', '%%%'],
  ])('rejects a malformed signature (%s) without throwing', (_name, sig) => {
    expect(verifyUpdateSignature(MESSAGE, sig, PUBLIC_PEM)).toBe(false);
  });

  it('rejects a non-Ed25519 key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    expect(verifyUpdateSignature(MESSAGE, signMessage(MESSAGE), rsa)).toBe(false);
  });

  it('fails closed while no key is configured', () => {
    expect(isUpdateSigningConfigured(null)).toBe(false);
    expect(verifyUpdateSignature(MESSAGE, signMessage(MESSAGE), null)).toBe(false);
  });

  it('matches what the signing script produces', async () => {
    // The CI script and the app must agree on the exact message bytes.
    const { buildMessage } = (await import('../../../scripts/sign-update.mjs')) as {
      buildMessage: (version: string, fileName: string, sha512: string) => Buffer;
    };
    expect(buildMessage('1.6.0', 'luna-1.6.0-mac-arm64.zip', 'digest==')).toEqual(MESSAGE);
  });

  it('ships with the placeholder until a real key is set (see SECURITY.md)', () => {
    // Update this expectation when the release key is added.
    expect(UPDATE_PUBLIC_KEY_PEM).toBeNull();
  });
});
