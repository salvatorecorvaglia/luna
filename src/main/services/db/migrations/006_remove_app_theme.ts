export default {
  name: '006_remove_app_theme',
  sql: `DELETE FROM settings WHERE key = 'theme';`,
};
