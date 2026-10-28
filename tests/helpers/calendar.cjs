const wrap = (...events) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ThingsMD tests//EN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const event = (properties) =>
  [
    'BEGIN:VEVENT',
    'UID:test',
    ...(properties.some((property) => /^SUMMARY[;:]/.test(property)) ? [] : ['SUMMARY:Meeting']),
    ...properties,
    'END:VEVENT',
  ].join('\r\n');
const body = (title = 'Meeting') =>
  wrap(event(['DTSTART:20261028T100000Z', 'DTEND:20261028T110000Z', `SUMMARY:${title}`]));
module.exports = { wrap, event, body };
