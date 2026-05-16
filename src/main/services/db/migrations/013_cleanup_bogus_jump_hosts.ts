export default {
  name: '013_cleanup_bogus_jump_hosts',
  sql: `
    -- Delete hidden jump host connections created by a bug in the MobaXterm importer
    -- that misidentified UI color settings (e.g. "180,180,192") as hostnames.
    -- Due to ON DELETE SET NULL, the main connections will be automatically cleaned.
    DELETE FROM connections
    WHERE is_hidden = 1
      AND name LIKE 'Jump: %'
      AND host LIKE '%,%';
  `,
};
