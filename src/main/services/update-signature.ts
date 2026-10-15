import { createPublicKey, verify } from 'node:crypto';

/**
 * Authenticity check for macOS self-updates.
 *
 * mac-self-update.ts verifies the downloaded zip against the SHA-512 in
 * `latest-mac.yml` — but that feed comes from the same GitHub release as the
 * zip, so anyone able to publish a release (a leaked token, a compromised
 * workflow) controls both, and the updater then strips quarantine and swaps
 * the bundle in. That proves integrity in transit, not who built it.
 *
 * This adds the missing half: the release workflow signs a short statement
 * binding version, file name and digest with an Ed25519 key that never leaves
 * CI secrets, and the app verifies it against a public key compiled in here.
 * A publisher without the private key can no longer ship an update.
 *
 * The digest is signed rather than the zip itself because Ed25519 (as Node
 * exposes it) signs the whole message in memory; the digest is already
 * computed while the zip streams, and SHA-512 makes the two equivalent.
 *
 * Key setup is documented in SECURITY.md ("Update signing").
 */

/**
 * Ed25519 public key (SPKI PEM) that release signatures must verify against.
 *
 * PLACEHOLDER: null until a real key is generated. While null, in-app updates
 * on ad-hoc macOS builds are disabled and users are sent to the GitHub release
 * page instead — failing closed rather than trusting unsigned bundles.
 */
export const UPDATE_PUBLIC_KEY_PEM: string | null = null;

/** Domain-separation prefix, so a signature can't be replayed for another purpose. */
const MESSAGE_PREFIX = 'luna-update-v1';

/**
 * The exact bytes the release workflow signs (scripts/sign-update.mjs builds
 * the same string). Binding version and file name stops a valid signature for
 * one release's zip being paired with a different version or architecture.
 */
export function updateSignatureMessage(version: string, fileName: string, sha512: string): Buffer {
  return Buffer.from(`${MESSAGE_PREFIX}\n${version}\n${fileName}\n${sha512}\n`, 'utf-8');
}

/** Whether a verification key is compiled in; without one, self-update stays off. */
export function isUpdateSigningConfigured(
  publicKeyPem: string | null = UPDATE_PUBLIC_KEY_PEM,
): boolean {
  return typeof publicKeyPem === 'string' && publicKeyPem.includes('BEGIN PUBLIC KEY');
}

/**
 * True only for a well-formed Ed25519 signature over `message` by the
 * configured key. Never throws: malformed keys or signatures are a `false`,
 * which the caller turns into a refused update.
 */
export function verifyUpdateSignature(
  message: Buffer,
  signatureBase64: string,
  publicKeyPem: string | null = UPDATE_PUBLIC_KEY_PEM,
): boolean {
  if (!isUpdateSigningConfigured(publicKeyPem)) return false;
  try {
    const key = createPublicKey(publicKeyPem as string);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const signature = Buffer.from(signatureBase64.trim(), 'base64');
    // Ed25519 signatures are exactly 64 bytes; reject anything else outright.
    if (signature.length !== 64) return false;
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}
