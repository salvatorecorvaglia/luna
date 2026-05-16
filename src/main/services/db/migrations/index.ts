/**
 * Ordered list of database migrations.
 *
 * One file per migration so the diff for a schema change is a new file
 * rather than a delta inside a single 200-line array — easier to review,
 * easier to revert, and impossible to accidentally re-order. The runtime
 * still keys applied migrations by `.name` (in the `_migrations` table),
 * so the only contract this index has to honour is: ordering. New
 * migrations must be appended; never insert in the middle, never rename.
 *
 * Explicit imports (rather than a glob) keep electron-vite's main-process
 * bundling deterministic — no Node-only `fs.readdir` magic at boot.
 */
import m001 from './001_connections';
import m002 from './002_settings';
import m003 from './003_history';
import m004 from './004_known_hosts_and_credentials';
import m005 from './005_ui_apply_terminal_theme';
import m006 from './006_remove_app_theme';
import m007 from './007_connection_indexes';
import m008 from './008_provider_columns';
import m009 from './009_connection_sort_order';
import m010 from './010_jump_host_connection_id';
import m011 from './011_manual_jump_host_columns';
import m012 from './012_connection_is_hidden';
import m013 from './013_cleanup_bogus_jump_hosts';
import m014 from './014_cleanup_bogus_jump_hosts_v2';
import m015 from './015_connection_list_composite_indexes';

export interface Migration {
  /** Stable identifier persisted in the `_migrations` table — never rename. */
  name: string;
  /** Runs inside a single transaction; multi-statement bodies are fine. */
  sql: string;
}

export const migrations: Migration[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
  m011,
  m012,
  m013,
  m014,
  m015,
];
