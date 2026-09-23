export default {
  name: '005_ui_apply_terminal_theme',
  sql: `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('ui.applyTerminalTheme', 'true');
  `,
};
