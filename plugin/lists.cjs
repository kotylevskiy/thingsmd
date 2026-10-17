const VIEW = 'things-project-view';
const TASKS = '.thingsmd-storage';
const LISTS = [
  ['inbox', 'Inbox', 'inbox'],
  ['today', 'Today', 'star'],
  ['upcoming', 'Upcoming', 'calendar-days'],
  ['anytime', 'Anytime', 'layers'],
  ['waiting', 'Waiting For', 'send-horizontal'],
  ['someday', 'Someday', 'archive'],
  ['logbook', 'Logbook', 'book-check'],
  ['trash', 'Trash', 'trash-2'],
];
const PAGES = [...LISTS, ['repeating', 'Repeating', 'repeat']];

function isListAvailable(page, settings) {
  return (
    !(page === 'inbox' && settings.captureDestination === 'daily-note') &&
    !(page === 'trash' && settings.trashRetention === 'immediately')
  );
}
function resolveList(page, settings) {
  if (!PAGES.some(([key]) => key === page)) page = 'inbox';
  if (page === 'trash' && !isListAvailable(page, settings)) page = 'inbox';
  return isListAvailable(page, settings) ? page : 'today';
}
module.exports = { VIEW, TASKS, LISTS, PAGES, isListAvailable, resolveList };
