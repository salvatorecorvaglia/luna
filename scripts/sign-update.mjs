#!/usr/bin/env node
/**
 * Sign macOS update zips for the in-app updater (see
 * src/main/services/update-signature.ts and SECURITY.md → "Update signing").
 *
 *   UPDATE_SIGNING_KEY="$(cat luna-update-private.pem)" \
 *     node scripts/sign-update.mjs <version> <dist-dir>
 *
 * For every `*-mac-*.zip` in <dist-dir>, writes `<zip>.sig`: the base64
 * Ed25519 signature over `buildMessage(version, fileName, sha512)`, where
 * sha512 is the base64 digest — the same value electron-builder writes to
 * latest-mac.yml and the app recomputes while downloading.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Must stay byte-identical to updateSignatureMessage() in the app. */
export function buildMessage(version, fileName, sha512) {
  return Buffer.from(`luna-update-v1\n${version}\n${fileName}\n${sha512}\n`, 'utf-8');
}

function sha512Base64(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')));
  });
}

async function main() {
  const [version, distDir] = process.argv.slice(2);
  const pem = process.env.UPDATE_SIGNING_KEY;
  if (!version || !distDir) {
    console.error('usage: node scripts/sign-update.mjs <version> <dist-dir>');
    process.exit(2);
  }
  if (!pem) {
    console.error('UPDATE_SIGNING_KEY is not set; refusing to publish unsigned updates.');
    process.exit(1);
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    console.error(`UPDATE_SIGNING_KEY must be an Ed25519 key (got ${key.asymmetricKeyType}).`);
    process.exit(1);
  }

  const zips = (await readdir(distDir)).filter((f) => /-mac-.*\.zip$/.test(f));
  if (zips.length === 0) {
    console.error(`No macOS zips found in ${distDir}.`);
    process.exit(1);
  }
  for (const zip of zips) {
    const path = join(distDir, zip);
    const digest = await sha512Base64(path);
    const signature = sign(null, buildMessage(version, basename(zip), digest), key);
    await writeFile(`${path}.sig`, `${signature.toString('base64')}\n`);
    process.stdout.write(`signed ${zip}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
