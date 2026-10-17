const { today } = require('./local-date.cjs');

// Persist evening as a local-day marker alongside Today. Any explicit schedule
// change clears an old evening marker unless the caller intentionally supplies it.
function normalizeSchedule(fields, day = today()) {
  if (!Object.hasOwn(fields, 'when')) return fields;
  return {
    ...fields,
    when: fields.when === 'evening' ? 'today' : fields.when,
    evening: fields.when === 'evening' ? day : (fields.evening ?? null),
  };
}
module.exports = { normalizeSchedule };
