const DEFAULT_FOLDER = 'ThingsMD';
const LEGACY_FOLDER = '.thingsmd-storage';
function taskFolder(value = DEFAULT_FOLDER) {
  if (typeof value !== 'string') throw new Error('Enter a vault-relative task folder.');
  const path = value.trim().replace(/\/+$/, '');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\[\]#|:*?"<>\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some((part) => !part || part.startsWith('.') || part.trim() !== part)
  )
    throw new Error(
      'Use a visible vault-relative folder, without empty, hidden, or parent segments.',
    );
  return path;
}
module.exports = { DEFAULT_FOLDER, LEGACY_FOLDER, taskFolder };
