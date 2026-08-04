export default {
  name: '018_unpadded_host_key_fingerprints',
  sql: `
    -- fingerprintKey() now emits OpenSSH-style unpadded base64 so the string
    -- Luna displays matches what 'ssh-keygen -lf' and the OpenSSH client show.
    -- Existing rows were stored with '=' padding; without this rewrite every
    -- already-trusted host would compare unequal on the next connect and be
    -- reported to the user as a changed host key — i.e. a false MITM alarm on
    -- every saved connection, which is exactly the signal we can least afford
    -- to make noisy.
    --
    -- Padding is purely positional (base64 of a 32-byte digest always ends in
    -- exactly one '='), so trimming it is lossless and reversible.
    UPDATE known_hosts
       SET fingerprint = rtrim(fingerprint, '=')
     WHERE fingerprint LIKE '%=';
  `,
};
