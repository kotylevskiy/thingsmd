const VIEW = 'thingsmd-project-view';
const LISTS = [
  ['inbox', 'Inbox', 'inbox'],
  ['today', 'Today', 'star'],
  ['upcoming', 'Upcoming', 'calendar-days'],
  ['anytime', 'Anytime', 'layers'],
  ['waiting', 'Waiting For', 'thingsmd-paper-plane'],
  ['someday', 'Someday', 'archive'],
  ['logbook', 'Logbook', 'book-check'],
  ['trash', 'Trash', 'trash-2'],
];
const PAGES = [...LISTS, ['repeating', 'Repeating', 'repeat']];

function isListAvailable(page, settings) {
  return (
    !(page === 'inbox' && settings.captureDestination === 'daily-note') &&
    !(page === 'waiting' && settings.enableWaiting === false) &&
    !(page === 'trash' && settings.trashRetention === 'immediately')
  );
}
function resolveList(page, settings) {
  if (!PAGES.some(([key]) => key === page)) page = 'inbox';
  if (page === 'waiting' && !isListAvailable(page, settings)) return 'anytime';
  if (page === 'trash' && !isListAvailable(page, settings)) page = 'inbox';
  return isListAvailable(page, settings) ? page : 'today';
}
module.exports = { VIEW, LISTS, PAGES, isListAvailable, resolveList };
