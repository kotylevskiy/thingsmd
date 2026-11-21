export const theme = process.env.THINGSMD_RECORDING_THEME ?? 'light';
if (theme !== 'light' && theme !== 'dark') {
  throw new Error('THINGSMD_RECORDING_THEME must be light or dark.');
}

export const themeClass = 'theme-' + theme;
export const colorMode = theme === 'light' ? 'moonstone' : 'obsidian';
export const rawDirectory = 'artifacts/screencast/replay-raw-' + theme;
export const renderDirectory = 'artifacts/screencast/replay-rendered-' + theme;
export const paddingColor = theme === 'light' ? '0xf5f6f8' : '0x181d23';
export const themeSource = new URL(
  '../../artifacts/documentation-preview/official-things-theme/',
  import.meta.url,
);
