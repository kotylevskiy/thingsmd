const ICAL = require('ical.js');
const moment = require('moment-timezone');
const { normalizeColor } = require('./color.cjs');
const MAX_BYTES = 8 * 1024 * 1024;
class CalendarError extends Error {}

// Feed definitions stay scoped to their component tree; calendars may define
// the same TZID differently. Bundled IANA data supplies missing definitions.
const fallbackZones = new Map();
function fallbackZone(id) {
  if (fallbackZones.has(id)) return fallbackZones.get(id);
  const data = moment.tz.zone(id);
  if (!data) throw new CalendarError('Calendar contains an unknown timezone.');
  const zone = new ICAL.Timezone({ tzid: id });
  zone.utcOffset = (time) =>
    -60 *
    data.parse(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second));
  fallbackZones.set(id, zone);
  return zone;
}
function milliseconds(time) {
  if (!time) throw new CalendarError('Calendar event is missing a start date.');
  if (time.isDate || time.zone === ICAL.Timezone.localTimezone)
    return new Date(
      time.year,
      time.month - 1,
      time.day,
      time.hour,
      time.minute,
      time.second,
    ).getTime();
  return time.toUnixTime() * 1000;
}
function cancelled(event) {
  return event.component.getFirstPropertyValue('status') === 'CANCELLED';
}
function parseCalendar(text) {
  try {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES)
      throw new CalendarError('Calendar exceeds the 8 MB limit.');
    const clean = text.replace(/^\uFEFF/, '').trim();
    // ICAL.parse accepts a truncated outer component; snapshots must be complete.
    const stack = [];
    let roots = 0;
    for (const line of clean.split(/\r?\n/)) {
      if (line.startsWith('BEGIN:')) {
        if (!stack.length) roots++;
        stack.push(line.slice(6));
      } else if (line.startsWith('END:') && stack.pop() !== line.slice(4)) {
        throw new CalendarError('Calendar download is incomplete.');
      }
    }
    if (
      stack.length ||
      roots !== 1 ||
      !clean.startsWith('BEGIN:VCALENDAR') ||
      !clean.endsWith('END:VCALENDAR')
    )
      throw new CalendarError('Calendar download is incomplete.');
    for (const line of clean.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
      if (/^RRULE[;:]/.test(line)) {
        const parts = line.slice(line.indexOf(':') + 1).split(';');
        if (
          parts.some((part) => !/^[A-Z]+=[^:;=]+$/.test(part)) ||
          !parts.some((part) =>
            /^FREQ=(SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(part),
          )
        )
          throw new CalendarError('Invalid calendar recurrence rule.');
      }
    }
    const component = new ICAL.Component(ICAL.parse(clean));
    if (component.name !== 'vcalendar' || component.getFirstPropertyValue('version') !== '2.0')
      throw new CalendarError('Expected an iCalendar 2.0 feed.');
    const suppliedZone = component.getTimeZoneByID.bind(component);
    component.getTimeZoneByID = (id) => suppliedZone(id) || fallbackZone(id);
    const groups = new Map();
    for (const child of component.getAllSubcomponents('vevent')) {
      const uid = child.getFirstPropertyValue('uid');
      if (!uid) throw new CalendarError('Calendar event is missing its UID.');
      // Validate temporal properties even for events outside Today.
      for (const prop of child.getAllProperties()) {
        if (
          ['dtstart', 'dtend', 'recurrence-id', 'exdate', 'rdate', 'rrule', 'duration'].includes(
            prop.name,
          )
        ) {
          const values = prop.getValues();
          if (prop.name === 'rrule') {
            for (const rule of values)
              if (rule.interval < 1 || (rule.count != null && rule.count < 1))
                throw new CalendarError('Invalid calendar recurrence rule.');
          }
        }
      }
      if (!child.hasProperty('dtstart') && child.getFirstPropertyValue('status') === 'CANCELLED') {
        const rid = child.getFirstPropertyValue('recurrence-id');
        child.addPropertyWithValue('dtstart', rid || ICAL.Time.fromString('1970-01-01T00:00:00Z'));
      }
      const event = new ICAL.Event(child, { exceptions: [] });
      event.periods = new Map();
      for (const prop of child.getAllProperties('rdate')) {
        if (prop.type !== 'period') continue;
        const periods = prop.getValues();
        for (const period of periods) {
          if (milliseconds(period.getEnd()) < milliseconds(period.start))
            throw new CalendarError('Invalid recurrence period.');
          event.periods.set(milliseconds(period.start), period.getEnd());
        }
        prop.resetType('date-time');
        prop.setValues(periods.map((period) => period.start));
      }
      if (
        !event.startDate ||
        event.endDate.isDate !== event.startDate.isDate ||
        milliseconds(event.endDate) < milliseconds(event.startDate)
      )
        throw new CalendarError('Calendar event has invalid dates.');
      const key = event.recurrenceId?.toString() || 'master';
      if (!groups.has(uid)) groups.set(uid, new Map());
      const entries = groups.get(uid);
      const previous = entries.get(key);
      if (!previous || event.sequence >= previous.sequence) entries.set(key, event);
    }
    if (groups.size > 50000) throw new CalendarError('Calendar contains too many events.');
    let refreshMs = 0;
    for (const key of ['refresh-interval', 'x-published-ttl']) {
      const value = component.getFirstPropertyValue(key);
      if (value) {
        try {
          const duration = typeof value === 'string' ? ICAL.Duration.fromString(value) : value;
          refreshMs = Math.max(refreshMs, duration.toSeconds() * 1000);
        } catch {
          /* Ignore invalid optional refresh hints. */
        }
      }
    }
    const name = ['name', 'x-wr-calname']
      .flatMap((key) => component.getAllProperties(key))
      .map((property) => {
        const value = property.getFirstValue();
        // ical.js treats these optional properties as unknown unless VALUE=TEXT is supplied.
        return property.type === 'unknown' && typeof value === 'string'
          ? ICAL.design.icalendar.value.text.fromICAL(value)
          : value;
      })
      .filter((value) => typeof value === 'string')
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .find(Boolean);
    return {
      groups,
      name: (name || 'Calendar').slice(0, 100),
      color:
        normalizeColor(component.getFirstPropertyValue('color'), false) ||
        normalizeColor(component.getFirstPropertyValue('x-apple-calendar-color')),
      refreshMs: Number.isFinite(refreshMs) ? Math.max(0, refreshMs) : 0,
    };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    // Parser errors can contain event contents or URLs. Never expose them.
    throw new CalendarError('Unable to parse this calendar.');
  }
}

function eventsOnDay(parsed, date = new Date(), { maxIterations = 200000 } = {}) {
  return eventsInRange(
    parsed,
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
    { maxIterations },
  );
}

function eventsInRange(parsed, fromDate, untilDate, { maxIterations = 200000 } = {}) {
  const start = fromDate.getTime(),
    end = untilDate.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new CalendarError('Invalid calendar date range.');
  const cacheKey = `${start}/${end}/${maxIterations}`;
  if (parsed.rangeCache?.has(cacheKey)) return parsed.rangeCache.get(cacheKey);
  const began = performance.now();
  const result = new Map();
  let iterations = 0;
  const add = (uid, details) => {
    if (cancelled(details.item)) return;
    const from = milliseconds(details.startDate),
      to = milliseconds(details.endDate);
    if (from >= end || (to > from ? to <= start : from < start)) return;
    const id = `${uid}/${details.recurrenceId ? milliseconds(details.recurrenceId) : 'single'}`;
    result.set(id, {
      id,
      title: details.item.summary || 'Untitled event',
      location: details.item.location || '',
      start: from,
      end: to,
      allDay: details.startDate.isDate,
    });
  };
  try {
    for (const [uid, group] of parsed.groups) {
      const original = group.get('master');
      const exceptions = [...group].filter(([key]) => key !== 'master').map(([, value]) => value);
      const master = original ? new ICAL.Event(original.component, { exceptions }) : null;
      if (master && !cancelled(master)) {
        if (master.isRecurring() || master.component.hasProperty('exdate')) {
          // DTSTART belongs to the recurrence set even with only RDATE values.
          const excludedStart = master.component
            .getAllProperties('exdate')
            .some((prop) =>
              prop
                .getValues()
                .some((value) => milliseconds(value) === milliseconds(master.startDate)),
            );
          if (!excludedStart) add(uid, master.getOccurrenceDetails(master.startDate));
          const iterator = master.iterator();
          let occurrence;
          const shift = Math.max(
            0,
            ...exceptions.map((e) => milliseconds(e.recurrenceId) - milliseconds(e.startDate)),
          );
          while ((occurrence = iterator.next())) {
            if (
              ++iterations > maxIterations ||
              (iterations % 256 === 0 && performance.now() - began > 2000)
            )
              throw new CalendarError('Calendar recurrence exceeds the expansion limit.');
            if (milliseconds(occurrence) >= end + shift) break;
            const details = master.getOccurrenceDetails(occurrence);
            if (details.item === master && original.periods.has(milliseconds(occurrence)))
              details.endDate = original.periods.get(milliseconds(occurrence));
            add(uid, details);
          }
        } else {
          add(uid, { item: master, startDate: master.startDate, endDate: master.endDate });
        }
      }
      // Moved exceptions can originate outside this range or lack a master.
      if (!master || !cancelled(master))
        for (const exception of exceptions)
          add(uid, {
            item: exception,
            startDate: exception.startDate,
            endDate: exception.endDate,
            recurrenceId: exception.recurrenceId,
          });
    }
    const events = [...result.values()].sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title),
    );
    parsed.rangeCache ||= new Map();
    parsed.rangeCache.set(cacheKey, events);
    // Keep Today and Upcoming hot without retaining every previously viewed period.
    if (parsed.rangeCache.size > 2) parsed.rangeCache.delete(parsed.rangeCache.keys().next().value);
    return events;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('Unable to expand calendar events.');
  }
}
module.exports = { parseCalendar, eventsOnDay, eventsInRange, CalendarError, MAX_BYTES };
