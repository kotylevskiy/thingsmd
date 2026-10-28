const { today, validDate } = require('../shared/local-date.cjs');
const { inToday, isTodayWhen } = require('./model.cjs');

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
// A deadline edit can bring an unstarted task into Today. A subsequent explicit
// move may defer it again; retain that choice for the current local day.
function applySchedulePolicy(meta, fields, day = today(), { creating = false } = {}) {
  const patch = normalizeSchedule(fields, day);
  const next = { ...meta, ...patch };
  const due = validDate(next.deadline) && next.deadline <= day;
  const scheduled = validDate(next.when);
  if (Object.hasOwn(patch, 'when')) {
    if (due && !scheduled && !['today', 'evening'].includes(next.when) && next.when != null)
      return { ...patch, deadlineDeferredOn: day };
    if (due && next.when == null && creating)
      return { ...patch, when: 'today', evening: null, deadlineDeferredOn: null };
    return { ...patch, deadlineDeferredOn: due && next.when == null ? day : null };
  }
  if (Object.hasOwn(patch, 'deadline') && patch.deadline !== meta.deadline) {
    if (
      !meta.repeat &&
      ((due && !(scheduled && next.when > day)) ||
        (inToday(meta, day) && !isTodayWhen(meta.when, day)))
    )
      return { ...patch, when: 'today', evening: null, deadlineDeferredOn: null };
    return { ...patch, deadlineDeferredOn: null };
  }
  return patch;
}
module.exports = { normalizeSchedule, applySchedulePolicy };
