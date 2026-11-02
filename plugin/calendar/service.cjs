const { parseCalendar, eventsOnDay, eventsInRange, CalendarError } = require('./parser.cjs');
const { dayKey } = require('../shared/local-date.cjs');
const { calendars, subscriptionUrl, retryDelay } = require('./model.cjs');
const { defaultColor } = require('./color.cjs');
const { generation, matchesSource, sourceKey } = require('./identity.cjs');
const { SNAPSHOT, stamp } = require('./snapshot.cjs');
const ROOT = 'ThingsMD/Calendars';
const GRACE = 60 * 60 * 1000;
class CalendarService {
  constructor({
    storage,
    request,
    secret,
    changed = () => {},
    now = Date.now,
    random = Math.random,
    uuid = () => crypto.randomUUID(),
    timeoutMs = 30000,
    root = ROOT,
    verified = async () => {},
    synchronize = async () => {},
  }) {
    Object.assign(this, {
      storage,
      request,
      secret,
      changed,
      now,
      random,
      uuid,
      timeoutMs,
      root,
      verified,
      synchronize,
    });
    this.config = [];
    this.states = new Map();
    this.pending = new Map();
    this.disposed = false;
  }
  configure(value) {
    this.config = calendars(value);
    for (const [id, state] of this.states) {
      const config = this.config.find((c) => c.id === id);
      if (
        !config ||
        config.secretName !== state.secretName ||
        generation(config) !== state.generation
      )
        this.states.delete(id);
    }
    this.changed();
  }
  state(config) {
    const current = this.config.find((c) => c.id === config.id);
    const existing = this.states.get(config.id);
    const next = () => ({
      secretName: config.secretName,
      generation: generation(config),
      next: 0,
      failures: 0,
    });
    if (
      !current ||
      current.secretName !== config.secretName ||
      generation(current) !== generation(config)
    )
      return next();
    if (
      !existing ||
      existing.secretName !== config.secretName ||
      existing.generation !== generation(config)
    )
      this.states.set(config.id, next());
    return this.states.get(config.id);
  }
  async current(config, state, root) {
    // The sync tool owns version ordering. Re-read its current file at each
    // asynchronous publication/deletion boundary instead of comparing revisions.
    await this.synchronize();
    return (
      this.active(config, state) &&
      root === this.root &&
      this.config.some(
        (c) => c.id === config.id && sourceKey(c.source) === sourceKey(config.source),
      )
    );
  }
  active(config, state) {
    return (
      !this.disposed &&
      !this.moving &&
      !!state &&
      this.states.get(config.id) === state &&
      this.config.some(
        (c) =>
          c.id === config.id &&
          c.enabled &&
          c.secretName === config.secretName &&
          generation(c) === generation(config),
      )
    );
  }
  async snapshots(config) {
    const folder = `${this.root}/${config.id}`;
    return (await this.storage.list(folder))
      .filter(
        (path) =>
          path.startsWith(folder + '/') &&
          (SNAPSHOT.exec(path.slice(folder.length + 1))?.[2] || '') === generation(config) &&
          SNAPSHOT.test(path.slice(folder.length + 1)),
      )
      .sort()
      .reverse();
  }
  async load(config, state = this.state(config)) {
    const paths = await this.snapshots(config);
    for (const path of paths) {
      try {
        const body = await this.storage.read(path);
        if (state.snapshot?.path === path && state.snapshot.body === body) return state.snapshot;
        const parsed = parseCalendar(body);
        eventsOnDay(parsed, new Date(this.now()));
        const snapshot = { path, body, parsed };
        // An overlapping scan that started before sync must not publish older
        // events after a newer scan has already selected a valid snapshot.
        if (state.snapshot?.path > path) return state.snapshot;
        if (this.active(config, state)) state.snapshot = snapshot;
        return snapshot;
      } catch {
        /* Incomplete sync or invalid newest snapshot: try its predecessor. */
      }
    }
    // An unreadable synchronized file must not blank an already loaded cache.
    return state.snapshot;
  }
  async reload() {
    if (this.moving || this.disposed) return;
    try {
      await this.synchronize();
    } catch {
      return;
    }
    for (const config of this.config.filter((c) => c.enabled)) {
      try {
        await this.load(config);
        await this.cleanupRetired(config).catch(() => {});
      } catch {
        this.state(config).error = 'Unable to read cached calendar.';
      }
    }
    if (!this.disposed) this.changed();
  }
  color(config) {
    return (
      config.color || this.states.get(config.id)?.snapshot?.parsed.color || defaultColor(config.id)
    );
  }
  today(date = new Date(this.now())) {
    return this.period(
      new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
    );
  }
  upcoming(date = new Date(this.now())) {
    const midnight = (offset) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    const { events, statuses } = this.period(midnight(1), midnight(8));
    const days = new Map();
    for (let offset = 1; offset <= 7; offset++) {
      const start = midnight(offset).getTime(),
        end = midnight(offset + 1).getTime();
      days.set(
        dayKey(midnight(offset)),
        events
          .filter(
            (event) =>
              event.start < end &&
              (event.end > event.start ? event.end > start : event.start >= start),
          )
          .map((event) => ({
            ...event,
            // Like Things, show a multi-day appointment as an all-day item on each day.
            allDay:
              event.allDay ||
              dayKey(new Date(event.start)) !==
                dayKey(new Date(Math.max(event.start, event.end - 1))),
          }))
          .sort(
            (a, b) =>
              Number(b.allDay) - Number(a.allDay) ||
              a.start - b.start ||
              a.title.localeCompare(b.title),
          ),
      );
    }
    return { days, statuses };
  }
  period(start, end) {
    const events = [],
      statuses = [];
    for (const config of this.config.filter((c) => c.enabled)) {
      const state = this.state(config);
      try {
        if (state.snapshot)
          events.push(
            ...eventsInRange(state.snapshot.parsed, start, end).map((event) => ({
              ...event,
              calendarId: config.id,
              calendarName: config.name,
              color: this.color(config),
            })),
          );
      } catch (error) {
        state.error = error.message;
      }
      statuses.push({
        id: config.id,
        name: config.name,
        error: this.settingsError || state.error || '',
        cached: !!state.snapshot,
        refreshing: this.pending.has(config.id),
      });
    }
    events.sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) || a.start - b.start || a.title.localeCompare(b.title),
    );
    return { events, statuses };
  }
  async refreshAll(force = false) {
    if (this.disposed || this.moving) return;
    try {
      await this.synchronize();
    } catch {
      return;
    }
    // Sequential requests avoid bursting against a provider with many calendars.
    for (const config of this.config.filter((c) => c.enabled)) {
      const root = this.root;
      await this.refresh(config, force);
      const current = this.config.find((c) => c.id === config.id && c.enabled);
      if (
        current &&
        (generation(current) !== generation(config) ||
          current.secretName !== config.secretName ||
          root !== this.root)
      )
        await this.refresh(current, force);
    }
  }
  refresh(config, force = false) {
    if (this.disposed || this.moving) return Promise.resolve();
    if (this.pending.has(config.id)) return this.pending.get(config.id);
    const state = this.state(config);
    if ((!force && state.next > this.now()) || state.retryAfter > this.now())
      return Promise.resolve();
    const work = this.fetch(config, state).finally(() => {
      this.pending.delete(config.id);
      if (!this.disposed) this.changed();
    });
    this.pending.set(config.id, work);
    this.changed();
    return work;
  }
  async fetch(config, state) {
    let timer;
    const root = this.root;
    try {
      if (!(await this.current(config, state, root))) return;
      await this.load(config, state);
      if (!(await this.current(config, state, root))) return;
      const value = await this.secret(config.secretName);
      if (!value) {
        state.error = 'Add the subscription URL in Calendar settings on this device to refresh.';
        state.next = this.now() + 60000;
        return;
      }
      let url;
      try {
        url = subscriptionUrl(value);
      } catch {
        throw new CalendarError('Use a valid HTTPS subscription URL.');
      }
      const headers = { Accept: 'text/calendar' };
      const validator = state.validator;
      if (validator?.url === url && validator.body === state.snapshot?.body) {
        if (validator.etag) headers['If-None-Match'] = validator.etag;
        else if (validator.modified) headers['If-Modified-Since'] = validator.modified;
      }
      if (!(await this.current(config, state, root))) return;
      const response = await Promise.race([
        this.request({ url, headers, method: 'GET', throw: false }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new CalendarError('Calendar download timed out.')),
            this.timeoutMs,
          );
        }),
      ]);
      clearTimeout(timer);
      if (!(await this.current(config, state, root))) return;
      if (subscriptionUrl(await this.secret(config.secretName)) !== url)
        throw new CalendarError('The subscription URL changed during refresh. Refresh again.');
      const responseHeaders = Object.fromEntries(
        Object.entries(response.headers || {}).map(([key, val]) => [key.toLowerCase(), val]),
      );
      if (response.status === 304) {
        if (
          !state.snapshot ||
          !validator ||
          validator.url !== url ||
          validator.body !== state.snapshot.body ||
          (!headers['If-None-Match'] && !headers['If-Modified-Since'])
        )
          throw new CalendarError('Calendar returned 304 without a matching cached snapshot.');
      } else if (response.status === 200) {
        const body = response.text;
        const parsed = parseCalendar(body);
        eventsOnDay(parsed, new Date(this.now()));
        const baseline =
          config.source ||
          (state.snapshot?.parsed.uid ? { uid: state.snapshot.parsed.uid } : undefined);
        if (baseline && !(await matchesSource(baseline, url, parsed.uid)))
          throw new CalendarError(
            'The saved subscription does not match this calendar. Open Calendar settings to reconnect.',
          );
        if (!this.active(config, state)) return;
        await this.verified(config, url, parsed);
        // First-time identity capture can enrich the same binding. A different
        // source or home still invalidates this request through its state/root.
        if (!this.active(config, state) || root !== this.root) return;
        config = this.config.find((c) => c.id === config.id);
        if (config.source && !(await matchesSource(config.source, url, parsed.uid))) return;
        // Re-read after the request: another device may have synced a snapshot.
        await this.load(config, state);
        if (!(await this.current(config, state, root))) return;
        if (body !== state.snapshot?.body) {
          const suffix = generation(config) ? `_s-${generation(config)}` : '';
          const path = `${this.root}/${config.id}/${stamp(this.now())}_${this.uuid()}${suffix}.ics`;
          await this.storage.create(path, body);
          if (!(await this.current(config, state, root))) {
            await this.storage.remove(path, body).catch(() => {});
            return;
          }
          // Filename ordering also applies when a synchronized clock is ahead.
          await this.load(config, state);
        }
        state.validator = {
          url,
          body,
          etag: responseHeaders.etag,
          modified: responseHeaders['last-modified'],
        };
      } else {
        state.retryAfter = this.now() + retryDelay(responseHeaders['retry-after'], this.now());
        throw new CalendarError(
          `Calendar download failed (HTTP ${Number(response.status) || 'error'}).`,
        );
      }
      state.error = '';
      state.failures = 0;
      state.next =
        this.now() +
        Math.max(
          config.refreshMinutes * 60000 + (this.random() * 120000 - 60000),
          state.snapshot?.parsed.refreshMs || 0,
          retryDelay(responseHeaders['retry-after'], this.now()),
        );
      // Cleanup failure does not turn a successful download into a failed fetch.
      await this.cleanup(config).catch(() => {});
    } catch (error) {
      if (!this.active(config, state)) return;
      if (this.settingsError) return;
      state.error =
        error instanceof CalendarError
          ? error.message
          : 'Unable to refresh calendar. Cached events are retained.';
      state.failures++;
      state.next = Math.max(
        state.retryAfter || 0,
        this.now() +
          Math.min(24 * 3600000, config.refreshMinutes * 60000 * 2 ** Math.min(state.failures, 8)),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async cleanup(config) {
    const state = this.state(config);
    const root = this.root;
    await this.cleanupRetired(config);
    let valid = 0;
    for (const path of await this.snapshots(config)) {
      if (!(await this.current(config, state, root))) return;
      const old = path.split('/').pop().slice(0, 24) < stamp(this.now() - GRACE);
      if (valid >= 3 && !old) continue;
      let body;
      try {
        body = await this.storage.read(path);
        const parsed = parseCalendar(body);
        if (valid < 3) eventsOnDay(parsed, new Date(this.now()));
      } catch {
        continue;
      }
      valid++;
      if (valid > 3 && old && this.states.get(config.id)?.snapshot?.path !== path) {
        if (!(await this.current(config, state, root))) return;
        await this.storage.remove(path, body);
      }
    }
  }
  async cleanupRetired(config) {
    const retired = new Set(config.source?.retiredGenerations || []);
    if (!retired.size) return;
    const state = this.states.get(config.id);
    const snapshot = state?.snapshot;
    const folder = `${this.root}/${config.id}`;
    if (!snapshot || !this.active(config, state) || !snapshot.path.startsWith(folder + '/')) return;
    const root = this.root;
    if (!(await this.current(config, state, root))) return;
    const match = SNAPSHOT.exec(snapshot.path.slice(folder.length + 1));
    if (!match || (match[2] || '') !== generation(config)) return;
    const paths = (await this.storage.list(folder)).filter((path) => {
      if (!path.startsWith(folder + '/')) return false;
      const entry = SNAPSHOT.exec(path.slice(folder.length + 1));
      // Unknown generations may belong to settings that have not synced yet.
      return entry && retired.has(entry[2] || '') && (entry[2] || '') !== generation(config);
    });
    if (!paths.length || !this.active(config, state)) return;
    // Keep the previous cache until a complete active-source snapshot is durable.
    if ((await this.storage.read(snapshot.path)) !== snapshot.body) return;
    for (const path of paths) {
      if (!this.active(config, state)) return;
      try {
        const body = await this.storage.read(path);
        if (!(await this.current(config, state, root))) return;
        await this.storage.remove(path, body);
      } catch {
        /* Retry sync races and failed cleanup on the next reload. */
      }
    }
  }
  dispose() {
    this.disposed = true;
  }
}
module.exports = { CalendarService, ROOT, SNAPSHOT };
