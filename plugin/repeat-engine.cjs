const { isFinished } = require('./task-status.cjs');
const { dayKey, addDays, validDate } = require('./local-date.cjs');
const { nextDate, availableDate, validate, patternOnDate } = require('./repeat-model.cjs');
const { WriteQueue } = require('./write-queue.cjs');
const { referenceRanges } = require('./task-references.cjs');
const { noteAccess } = require('./note-access.cjs');

// One local writer; deterministic copy IDs make interrupted generation retryable.
module.exports = function installRepeating(plugin) {
  const writes = new WriteQueue();
  const notes = noteAccess(plugin.app);
  let disposed = false;
  plugin.register?.(() => {
    disposed = true;
  });
  const serial = (fn) =>
    writes.run('repeat', () => {
      if (!disposed) return fn();
    });
  const find = async (id) => (await plugin.taskRecords()).find((t) => t.meta.id === id);
  const writeRule = async (task, rule) => {
    await plugin.update(task.file, (current) => {
      if (JSON.stringify(current.meta.repeat) !== JSON.stringify(task.meta.repeat))
        throw new Error('The repeating rule changed elsewhere. Reopen it and try again.');
      return {
        ...current,
        meta: {
          ...current.meta,
          repeat: rule,
          when: availableDate(rule),
          deadline: null,
          status: 'todo',
          completed: null,
        },
      };
    });
    return find(task.meta.id);
  };
  const placeCopy = async (template, copy) => {
    // Insert beside the template in every containing note, preserving normal prose.
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const apply = (text) => {
        if (referenceRanges(text, copy.file.path).length) return text;
        const refs = referenceRanges(text, template.file.path);
        if (!refs.length) return text;
        const newline = text.includes('\r\n') ? '\r\n' : '\n';
        for (const r of refs.reverse())
          text =
            text.slice(0, r.from) +
            `![[${copy.file.path.slice(0, -3)}]]` +
            newline +
            text.slice(r.from);
        return text;
      };
      const before = await notes.read(file);
      await notes.write(file, before, apply(before), { save: true });
    }
  };
  const generate = async (
    task,
    { complete = false, status = 'done', exception = null, now = new Date() } = {},
  ) => {
    const rule = task.meta.repeat;
    if (!rule?.next) throw new Error('This rule is waiting for its current copy or has ended.');
    const nominal = rule.next,
      id = `repeat-${task.meta.id}-${rule.epoch}-${nominal}`;
    let copy = await find(id);
    if (!copy) {
      const fields = JSON.parse(JSON.stringify(task.meta));
      for (const key of [
        'id',
        'created',
        'repeat',
        'deleted',
        'deletedAt',
        'completed',
        'loggedAt',
      ])
        delete fields[key];
      Object.assign(fields, {
        status: complete ? status : 'todo',
        when: exception || availableDate(rule),
        deadline: rule.deadline ? nominal : null,
        repeatSource: task.meta.id,
        repeatDate: nominal,
        repeatEpoch: rule.epoch,
        order: (Number(task.meta.order) || 0) - 0.001,
        checklist: (fields.checklist || []).map((item) => ({ ...item, done: false })),
      });
      if (complete) fields.completed = now.toISOString();
      copy = await plugin.createTask(fields, id, task.body);
    }
    if (complete && !isFinished(copy.meta)) {
      await plugin.update(copy.file, (current) => ({
        ...current,
        meta: { ...current.meta, status, completed: now.toISOString() },
      }));
      copy = await find(copy.meta.id);
    }
    await placeCopy(task, copy);
    const next = {
      ...rule,
      lastCopy: copy.meta.id,
      waitingFor: rule.mode === 'completion' ? copy.meta.id : null,
      next: rule.mode === 'regular' ? nextDate(rule, nominal) : null,
    };
    await writeRule(task, next);
    return copy;
  };
  const reconcile = async (now = new Date()) => {
    const today = dayKey(now);
    const templates = (await plugin.taskRecords()).filter((t) => t.meta.repeat && !t.meta.deleted);
    const errors = [];
    for (let task of templates) {
      if (disposed) return;
      try {
        let rule = task.meta.repeat;
        validate(rule);
        if (rule.paused) continue;
        if (rule.mode === 'completion' && !rule.waitingFor && rule.lastCopy && rule.next) {
          const previous = await find(rule.lastCopy);
          if (previous && !previous.meta.deleted && !isFinished(previous.meta)) {
            rule = { ...rule, waitingFor: previous.meta.id, next: null };
            task = await writeRule(task, rule);
          }
        }
        if (rule.waitingFor) {
          const previous = await find(rule.waitingFor);
          if (isFinished(previous?.meta) && !previous.meta.deleted && previous.meta.completed) {
            const completed = new Date(previous.meta.completed);
            if (!Number.isNaN(completed.getTime())) {
              rule = { ...rule, waitingFor: null, next: nextDate(rule, dayKey(completed)) };
              task = await writeRule(task, rule);
            }
          }
        }
        // Process a bounded batch; never drop missed fixed-schedule occurrences.
        for (
          let i = 0;
          i < 100 && task.meta.repeat.next && availableDate(task.meta.repeat) <= today;
          i++
        ) {
          if (disposed) return;
          await generate(task, { now });
          task = await find(task.meta.id);
          if (task.meta.repeat.mode === 'completion') break;
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, errors.map((e) => e.message).join('\n'));
  };
  const api = (plugin.repeating = {
    tick: (now) => serial(() => reconcile(now)),
    configure: (task, config) =>
      serial(async () => {
        const current = await find(task.meta.id);
        if (!current || current.meta.repeatSource)
          throw new Error('Edit the repeating template instead of its copy.');
        if (JSON.stringify(task.meta.repeat) !== JSON.stringify(current.meta.repeat))
          throw new Error('This rule changed elsewhere. Reopen it.');
        let rule = {
          ...config,
          epoch: current.meta.repeat?.epoch || crypto.randomUUID(),
          waitingFor: null,
          lastCopy: current.meta.repeat?.lastCopy || null,
          paused: false,
        };
        validate(rule);
        rule.next = rule.mode === 'regular' ? nextDate(rule, rule.anchor, true) : rule.anchor;
        if (rule.mode === 'completion' && rule.lastCopy) {
          const previous = await find(rule.lastCopy);
          if (previous && !previous.meta.deleted && !isFinished(previous.meta)) {
            rule.waitingFor = previous.meta.id;
            rule.next = null;
          }
        }
        await writeRule(current, rule);
        await reconcile();
      }),
    createNext: (id, complete = false, expectedNext, status = 'done') =>
      serial(async () => {
        const task = await find(id);
        if (expectedNext !== undefined && task?.meta.repeat?.next !== expectedNext)
          throw new Error('This occurrence has already advanced.');
        const copy = await generate(task, { complete, status });
        await reconcile();
        return copy;
      }),
    pause: (id, paused) =>
      serial(async () => {
        const task = await find(id),
          rule = { ...task.meta.repeat, paused };
        if (!paused && rule.next && availableDate(rule) < dayKey(new Date()))
          rule.next =
            rule.mode === 'regular'
              ? nextDate(rule, addDays(dayKey(new Date()), rule.deadline ? rule.leadDays : 0), true)
              : dayKey(new Date());
        await writeRule(task, rule);
        await reconcile();
      }),
    stop: (id) =>
      serial(async () => {
        const task = await find(id);
        await plugin.update(task.file, (current) => ({
          ...current,
          meta: {
            ...current.meta,
            repeat: null,
            when: availableDate(current.meta.repeat) || 'anytime',
            deadline: current.meta.repeat.deadline ? current.meta.repeat.next : null,
          },
        }));
      }),
    shiftRule: (id, when) =>
      serial(async () => {
        const task = await find(id);
        if (!task?.meta.repeat) throw new Error('The repeating template is unavailable.');
        const rule = task.meta.repeat,
          key = when === 'today' ? dayKey(new Date()) : when;
        if (!validDate(key)) throw new Error('Choose a date for a repeating task.');
        const nominal = addDays(key, rule.deadline ? rule.leadDays : 0);
        const changed = {
          ...rule,
          anchor: nominal,
          on: patternOnDate(rule.unit, nominal),
        };
        changed.next = nextDate(changed, nominal);
        await writeRule(task, changed);
      }),
    reschedule: (id, when, updateRule) =>
      serial(async () => {
        const task = await find(id),
          rule = task.meta.repeat;
        if (!rule?.next) throw new Error('This repeating task has no scheduled next copy.');
        const key = when === 'today' ? dayKey(new Date()) : when;
        if (!validDate(key)) throw new Error('Choose a date for a repeating task.');
        if (rule.mode === 'regular' && !updateRule) {
          await generate(task, { exception: key });
          return;
        }
        const nominal = addDays(key, rule.deadline ? rule.leadDays : 0);
        const next = { ...rule, next: nominal };
        if (updateRule) {
          next.anchor = nominal;
          next.on = patternOnDate(rule.unit, nominal);
        }
        validate(next);
        await writeRule(task, next);
        await reconcile();
      }),
  });
  return api;
};
