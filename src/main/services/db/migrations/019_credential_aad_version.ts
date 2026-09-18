export default {
  name: '019_credential_aad_version',
  sql: `
    -- Credential blobs are AES-256-GCM, but nothing was bound to the row they
    -- belong to: encrypt() took only the plaintext. So a GCM tag stayed valid
    -- after the blob was moved, and anyone able to write luna.db could swap
    -- encrypted_data between two rows to make connection B authenticate with
    -- connection A's password — with no tamper-log entry, because both halves
    -- decrypt perfectly.
    --
    -- connection_id is now passed as additional authenticated data, which binds
    -- each ciphertext to its row. This column says which scheme a row uses, so
    -- the transition is deterministic rather than a decrypt-and-retry guess: 0
    -- is the original no-AAD format, 1 binds connection_id. Rows are rewritten
    -- to 1 opportunistically, the next time each one is read.
    --
    -- Defaulting to 0 is what makes this safe: existing rows keep decrypting.
    -- Guessing the format from the blob would risk reporting a perfectly good
    -- credential as tampered.
    ALTER TABLE credentials ADD COLUMN aad_version INTEGER NOT NULL DEFAULT 0;
  `,
};
