export default {
  name: '014_cleanup_bogus_jump_hosts_v2',
  sql: `
    -- Delete hidden jump host connections created by a bug in the MobaXterm importer
    -- that misidentified internal variables (e.g. "_Std_Colors_0_") as hostnames.
    DELETE FROM connections
    WHERE is_hidden = 1
      AND name LIKE 'Jump: %'
      AND (host LIKE '%\\_%' ESCAPE '\\' OR host LIKE '%MobaFont%');
  `,
};
