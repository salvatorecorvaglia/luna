/**
 * Composite indexes for the two hottest connection queries. Without these,
 * the existing single-column indexes on (sort_order) and (name) can be used
 * to satisfy a filter or a sort but not both at once, so CONNECTION_LIST
 * ends up doing a temp-B-tree sort over the result set. Drop the now-
 * redundant single-column indexes that the composites cover.
 *
 *  - idx_connections_sort_order_name covers:
 *      SELECT * FROM connections ORDER BY sort_order ASC, name ASC
 *  - idx_connections_folder_sort_name covers:
 *      SELECT * FROM connections WHERE folder = ? ORDER BY sort_order, name
 */
export default {
  name: '015_connection_list_composite_indexes',
  sql: `
    DROP INDEX IF EXISTS idx_connections_sort_order;
    DROP INDEX IF EXISTS idx_connections_name;
    CREATE INDEX IF NOT EXISTS idx_connections_sort_order_name
      ON connections(sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_connections_folder_sort_name
      ON connections(folder, sort_order, name);
  `,
};
