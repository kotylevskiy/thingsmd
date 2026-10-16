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

module.exports = { VIEW, TASKS, LISTS, PAGES };
