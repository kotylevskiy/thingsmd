// Persisted preferences are normalized here; UI and policies consume this shape.
const LOG_MODES = ['immediately', 'daily', 'weekly', 'monthly', 'manually'];
const { validTimeZone, systemTimeZone } = require('./vault-time.cjs');
function settings(data = {}) {
  return {
    tasksFolder: require('./task-folder-policy.cjs').taskFolder(data?.tasksFolder ?? 'ThingsMD'),
    tasksFolderDisplay: ['normal', 'last', 'hidden'].includes(data?.tasksFolderDisplay)
      ? data.tasksFolderDisplay
      : 'hidden',
    taskNotesTab: data?.taskNotesTab === 'current' ? 'current' : 'new',
    globalCaptureHotkey:
      typeof data?.globalCaptureHotkey === 'string' ? data.globalCaptureHotkey.trim() : '',
    showWaitingInToday: data?.showWaitingInToday !== false,
    enableWaiting: data?.enableWaiting === true,
    mobileTaskNavigation: data?.mobileTaskNavigation === true,
    showProjectProgress: data?.showProjectProgress !== false,
    captureDestination: data?.captureDestination === 'daily-note' ? 'daily-note' : 'inbox',
    logbook: LOG_MODES.includes(data?.logbook) ? data.logbook : 'daily',
    trashRetention: [
      'never',
      'immediately',
      '1-week',
      '5-years',
      '3-years',
      '1-year',
      '3-months',
      '1-month',
    ].includes(data?.trashRetention)
      ? data.trashRetention
      : 'never',
    timeZone: validTimeZone(data?.timeZone) ? data.timeZone : systemTimeZone(),
  };
}
module.exports = { settings };
