const { hasOtherLinks } = require('./references.cjs');
const { scan, baseline, restore } = require('./format.cjs');
const { taskReferences } = require('../notes/task-references.cjs');
const { noteAccess } = require('../shared/note-access.cjs');
const { rollbackNotes, recoveryError } = require('../shared/note-rollback.cjs');

const overlaps = (item, ranges) =>
  !ranges || ranges.some((range) => item.from < range.to && item.to > range.from);

// Plans retain the exact source buffers shown to the user. Execution never
// silently rescans a changed selection or expands a confirmed vault-wide scope.
module.exports = function installConversion(plugin) {
  const app = plugin.app,
    notes = noteAccess(app);
  const write = (file, before, after) => notes.write(file, before, after, { save: true });
  const otherLinks = (text, path, sourcePath, allowPlacements = true) =>
    hasOtherLinks(
      text,
      path,
      sourcePath,
      (target, source) => app.metadataCache?.getFirstLinkpathDest(target, source),
      allowPlacements,
    );
  const diskTask = (file) => app.vault.adapter.read(file.path);
  let busy = false;
  async function documents(onlyPath) {
    const result = [];
    for (const file of app.vault.getMarkdownFiles()) {
      if (
        (onlyPath && file.path !== onlyPath) ||
        file.path.startsWith(plugin.settings.tasksFolder + '/')
      )
        continue;
      result.push({ file, text: await notes.read(file), disk: await app.vault.read(file) });
    }
    return result;
  }
  plugin.planConversion = async ({ direction, path, ranges, expected, taskPath } = {}) => {
    if (!['thingsmd', 'inline'].includes(direction)) throw new Error('Choose a conversion format');
    const docs = await documents(direction === 'thingsmd' ? path : undefined);
    const selected = docs.filter((doc) => !path || doc.file.path === path);
    if (path && (!selected.length || (expected !== undefined && selected[0].text !== expected)))
      throw new Error('This note changed. Please try again.');
    const tasks = direction === 'inline' ? await plugin.taskRecords() : [];
    const eligible = new Map(
      tasks
        .filter(
          (task) =>
            task.meta.conversion?.version === 1 && !task.conflicts?.length && !task.meta.deleted,
        )
        .map((task) => [task.file.path, task]),
    );
    const imports = [],
      paths = new Set();
    let skipped = 0;
    for (const doc of selected) {
      if (direction === 'thingsmd') {
        const parsed = scan(doc.text);
        for (const item of parsed.tasks.filter((item) => overlaps(item, ranges)))
          imports.push({ doc, item });
        skipped += parsed.invalid.filter((item) => overlaps(item, ranges)).length;
      } else {
        for (const ref of taskReferences(doc.text))
          if (
            (!taskPath || ref.path === taskPath) &&
            eligible.has(ref.path) &&
            overlaps(ref, ranges)
          )
            paths.add(ref.path);
      }
    }
    const exports = [];
    for (const path of paths) {
      const indexed = eligible.get(path);
      const disk = await diskTask(indexed.file);
      const { raw, meta, body } = await plugin.readTaskSnapshot(indexed.file);
      if (meta.id !== indexed.meta.id || meta.deleted) throw new Error('Task identity changed');
      const task = { ...indexed, meta, body };
      try {
        const text = restore(task);
        if (
          tasks.some(
            (other) =>
              other.file.path !== path &&
              otherLinks(
                other.body + '\n' + JSON.stringify(other.meta),
                path,
                other.file.path,
                false,
              ),
          )
        )
          throw new Error('Another task note links to this task');
        const occurrences = [];
        for (const doc of docs) {
          if (otherLinks(doc.text, path, doc.file.path))
            throw new Error('A non-task link still references this task');
          const refs = taskReferences(doc.text).filter((ref) => ref.path === path);
          for (const ref of refs) occurrences.push({ doc, ref });
        }
        exports.push({
          task,
          text,
          occurrences,
          raw,
          disk,
        });
      } catch {
        skipped++;
      }
    }
    const affected = new Set([
      ...imports.map(({ doc }) => doc.file.path),
      ...exports.flatMap(({ occurrences }) => occurrences.map(({ doc }) => doc.file.path)),
    ]);
    return {
      direction,
      imports,
      exports,
      skipped,
      count: imports.length + exports.length,
      noteCount: affected.size,
    };
  };
  async function assertDoc(doc, expected = doc.text, disk = doc.disk) {
    if ((await notes.read(doc.file)) !== expected || (await app.vault.read(doc.file)) !== disk)
      throw new Error(`${doc.file.path} changed. Please try again.`);
  }
  plugin.runConversion = async (plan) => {
    if (busy || plugin.movingTasks)
      throw new Error('Another conversion or folder move is still finishing.');
    busy = true;
    plugin.conversionBusy = true;
    const edits = [],
      created = [],
      removed = [];
    try {
      const replacements = new Map();
      const add = (doc, from, to, text) => {
        if (!replacements.has(doc)) replacements.set(doc, []);
        replacements.get(doc).push({ from, to, text });
      };
      // Check the full affected set before the first mutation.
      const affected = new Set([
        ...plan.imports.map(({ doc }) => doc),
        ...plan.exports.flatMap(({ occurrences }) => occurrences.map(({ doc }) => doc)),
      ]);
      for (const doc of affected) await assertDoc(doc);
      for (const entry of plan.exports) {
        if (plugin.hasTaskDraft?.(entry.task.file.path))
          throw new Error('Save or close the task draft before converting.');
        if (
          (await plugin.readTask(entry.task.file)) !== entry.raw ||
          (await diskTask(entry.task.file)) !== entry.disk
        )
          throw new Error('This task changed. Please try again.');
        await plugin.assertTaskAuthority(entry.task.file, entry.task.meta.id);
      }
      for (const { doc, item } of plan.imports) {
        let task = await plugin.createTask({
          ...item.fields,
          conversion: { version: 1, line: item.line, format: item.format, source: doc.file.path },
        });
        created.push({ task, raw: await plugin.readTask(task.file) });
        task = await plugin.update(task.file, (record) => {
          if (
            JSON.stringify(record.meta) !== JSON.stringify(task.meta) ||
            record.body !== task.body
          )
            throw new Error('The new task changed during conversion. Its file was retained.');
          return {
            ...record,
            meta: {
              ...record.meta,
              conversion: { ...record.meta.conversion, baseline: baseline(task.meta) },
            },
          };
        });
        created.at(-1).task = task;
        created.at(-1).raw = await plugin.readTask(task.file);
        add(doc, item.from, item.to, `![[${task.file.path.replace(/\.md$/, '')}]]`);
      }
      for (const { text, occurrences } of plan.exports) {
        for (const { doc, ref } of occurrences) {
          const original = doc.text.slice(ref.from, ref.to);
          const newline = original.endsWith('\r\n') ? '\r\n' : original.endsWith('\n') ? '\n' : '';
          add(
            doc,
            ref.from,
            ref.to,
            text.replaceAll('\n', doc.text.includes('\r\n') ? '\r\n' : '\n') + newline,
          );
        }
      }
      for (const [doc, changes] of replacements) {
        await assertDoc(doc);
        let after = doc.text;
        for (const change of changes.sort((a, b) => b.from - a.from))
          after = after.slice(0, change.from) + change.text + after.slice(change.to);
        edits.push({ file: doc.file, before: doc.text, after });
        await write(doc.file, doc.text, after);
        if ((await app.vault.read(doc.file)) !== after)
          throw new Error(`${doc.file.path} did not finish saving.`);
      }
      for (const entry of plan.exports) {
        const path = entry.task.file.path;
        await plugin.taskQueue.run(path, async () => {
          if (
            plugin.hasTaskDraft?.(path) ||
            (await plugin.readTask(path)) !== entry.raw ||
            (await diskTask(entry.task.file)) !== entry.disk
          )
            throw new Error('This task changed. Its file was retained.');
          await plugin.assertTaskAuthority(entry.task.file, entry.task.meta.id);
          // Recheck ALL notes: sync or another editor may have added a reference.
          for (const doc of await documents())
            if (
              taskReferences(doc.text).some((ref) => ref.path === path) ||
              otherLinks(doc.text, path, doc.file.path)
            )
              throw new Error(`A reference to ${path} appeared during conversion.`);
          for (const edit of edits)
            if (
              (await notes.read(edit.file)) !== edit.after ||
              (await app.vault.read(edit.file)) !== edit.after
            )
              throw new Error(`${edit.file.path} changed during conversion.`);
          for (const other of await plugin.taskRecords())
            if (
              other.file.path !== path &&
              otherLinks(
                other.body + '\n' + JSON.stringify(other.meta),
                path,
                other.file.path,
                false,
              )
            )
              throw new Error(`A task note now links to ${path}.`);
          removed.push(entry);
          const indexed = app.vault.getAbstractFileByPath(path);
          if (indexed) await app.vault.delete(indexed);
          else await app.vault.adapter.remove(path);
        });
      }
      plugin.tasksChanged();
      return { converted: plan.count, skipped: plan.skipped };
    } catch (error) {
      const failures = [];
      for (const entry of removed) {
        try {
          if (!(await app.vault.adapter.exists(entry.task.file.path)))
            await app.vault.create(entry.task.file.path, entry.raw);
          else if (
            (await plugin.readTask(entry.task.file)) !== entry.raw ||
            (await diskTask(entry.task.file)) !== entry.disk
          )
            throw new Error('Task file changed');
        } catch (failure) {
          failures.push(`${entry.task.file.path}: ${failure.message}`);
        }
      }
      failures.push(
        ...(await rollbackNotes(edits, async (file, after, before) => {
          if ((await notes.read(file)) !== before) await write(file, after, before);
        })),
      );
      // Keep new task files if rollback failed: a surviving reference needs them.
      if (!failures.length)
        for (const { task, raw } of created) {
          try {
            const current = await plugin.readTaskSnapshot(task.file);
            if (
              current.raw !== raw ||
              JSON.stringify(current.meta) !== JSON.stringify(task.meta) ||
              current.body !== task.body
            )
              throw new Error('New task was edited; file retained');
            await plugin.deleteTask(task.file);
          } catch (failure) {
            failures.push(`${task.file.path}: ${failure.message}`);
          }
        }
      throw recoveryError(error, failures);
    } finally {
      busy = false;
      plugin.conversionBusy = false;
      plugin.tasksChanged();
    }
  };
  plugin.register(() => {
    delete plugin.planConversion;
    delete plugin.runConversion;
  });
};
