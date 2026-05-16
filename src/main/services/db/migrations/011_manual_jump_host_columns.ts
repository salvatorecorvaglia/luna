export default {
  name: '011_manual_jump_host_columns',
  sql: `
    ALTER TABLE connections ADD COLUMN jump_host_host TEXT;
    ALTER TABLE connections ADD COLUMN jump_host_port INTEGER;
    ALTER TABLE connections ADD COLUMN jump_host_username TEXT;
    ALTER TABLE connections ADD COLUMN jump_host_auth_type TEXT
      CHECK (jump_host_auth_type IN ('password', 'key', 'key+passphrase'));
    ALTER TABLE connections ADD COLUMN jump_host_private_key_path TEXT;
  `,
};
