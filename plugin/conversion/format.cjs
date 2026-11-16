const { validDate, today } = require('../shared/local-date.cjs');
const { nextFence } = require('../shared/markdown-fence.cjs');

const dates = ['created', 'scheduled', 'start', 'due', 'completion', 'cancelled'];
const symbols = {
  '➕': 'created',
  '⏳': 'scheduled',
  '⌛': 'scheduled',
  '🛫': 'start',
  '📅': 'due',
  '📆': 'due',
  '🗓': 'due',
  '✅': 'completion',
  '❌': 'cancelled',
  '🔺': 'priority',
  '⏫': 'priority',
  '🔼': 'priority',
  '🔽': 'priority',
  '⏬': 'priority',
  '🔁': 'repeat',
  '🏁': 'onCompletion',
  '🆔': 'id',
  '⛔': 'dependsOn',
};
const canonical = {
  created: '➕',
  scheduled: '⏳',
  start: '🛫',
  due: '📅',
  completion: '✅',
  cancelled: '❌',
};
const heading = /^([\t >]*)([-+*]|\d+[.)])([ \t]+)\[([^\]\r\n])\]([ \t]*)(.*)$/;

// Token offsets allow unchanged fields (including unknown fields) to round-trip
// byte for byte. Inline code is opaque; nested brackets in Dataview values survive.
function fieldsIn(text) {
  const tokens = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw new Error('Unclosed comment');
      tokens.push({
        from: i,
        to: end + 3,
        key: `comment-${i}`,
        value: text.slice(i, end + 3),
        format: 'opaque',
      });
      i = end + 3;
      continue;
    }
    const block = text.slice(i).match(/^\^[a-zA-Z0-9-]+$/);
    if (block && (i === 0 || /\s/.test(text[i - 1]))) {
      tokens.push({ from: i, to: text.length, key: 'blockId', value: block[0], format: 'opaque' });
      break;
    }
    if (text[i] === '`') {
      const ticks = text.slice(i).match(/^`+/)[0];
      const end = text.indexOf(ticks, i + ticks.length);
      i = end < 0 ? text.length : end + ticks.length;
      continue;
    }
    const open = text[i];
    if (open === '[' || open === '(') {
      const match = text.slice(i).match(/^[[(]([^\[\]():\r\n]+?)\s*::\s*/);
      if (match) {
        const close = open === '[' ? ']' : ')';
        let depth = 1,
          end = i + match[0].length;
        for (; end < text.length && depth; end++) {
          if (text[end] === open) depth++;
          if (text[end] === close) depth--;
        }
        if (depth) throw new Error('Unclosed Dataview field');
        const valueFrom = i + match[0].length;
        const value = text.slice(valueFrom, end - 1).trimEnd();
        tokens.push({
          from: i,
          to: end,
          key: match[1].trim(),
          value,
          valueFrom,
          valueTo: valueFrom + value.length,
          format: 'dataview',
        });
        i = end;
        continue;
      }
    }
    const symbol = Object.keys(symbols).find((s) => text.startsWith(s, i));
    if (!symbol) {
      i++;
      continue;
    }
    const key = symbols[symbol];
    let end = i + symbol.length;
    if (text[end] === '\uFE0F') end++;
    if (key === 'priority') {
      tokens.push({ from: i, to: end, key, value: symbol, format: 'emoji' });
      i = end;
      continue;
    }
    const start = end + text.slice(end).match(/^[ \t]*/)[0].length;
    if (dates.includes(key)) {
      const value = text.slice(start).match(/^\d{4}-\d{2}-\d{2}(?![\w-])/)?.[0];
      if (!value || !validDate(value)) throw new Error('Invalid date');
      end = start + value.length;
      tokens.push({
        from: i,
        to: end,
        key,
        value,
        valueFrom: start,
        valueTo: end,
        format: 'emoji',
      });
    } else {
      const rest = text.slice(start);
      const boundary = rest.search(
        /[➕⏳⌛🛫📅📆🗓✅❌🔺⏫🔼🔽⏬🔁🏁🆔⛔]|[[(][\w-]+\s*::|<!--|\s+\^[a-zA-Z0-9-]+$/u,
      );
      const value = (boundary < 0 ? rest : rest.slice(0, boundary)).trimEnd();
      end = start + value.length;
      tokens.push({
        from: i,
        to: end,
        key,
        value,
        valueFrom: start,
        valueTo: end,
        format: 'emoji',
      });
    }
    i = end;
  }
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token.key)) throw new Error('Duplicate or mixed metadata field');
    seen.add(token.key);
    if (dates.includes(token.key) && !validDate(token.value)) throw new Error('Invalid date');
    if (token.key === 'onCompletion' && !['keep', 'delete'].includes(token.value))
      throw new Error('Invalid completion instruction');
    if (
      token.key === 'priority' &&
      token.format === 'dataview' &&
      !['lowest', 'low', 'normal', 'medium', 'high', 'highest'].includes(token.value)
    )
      throw new Error('Invalid priority');
    if (
      ['id', 'dependsOn'].includes(token.key) &&
      !/^[a-zA-Z0-9_-]+(?:\s*,\s*[a-zA-Z0-9_-]+)*$/.test(token.value)
    )
      throw new Error('Invalid task ID');
  }
  return tokens;
}
function parseLine(line) {
  const match = line.match(heading);
  if (!match) return null;
  const [, indent, marker, gap, status, space, content] = match;
  try {
    const tokens = fieldsIn(content);
    let title = content;
    for (const token of [...tokens].reverse())
      title = title.slice(0, token.from) + title.slice(token.to);
    title = title.trim().replace(/[ \t]{2,}/g, ' ');
    if (!title) return null;
    const values = Object.fromEntries(tokens.map((t) => [t.key, t.value]));
    return {
      line,
      indent,
      marker,
      gap,
      status,
      space,
      content,
      tokens,
      format: tokens.some((t) => t.format === 'dataview') ? 'dataview' : 'emoji',
      scheduleKey: values.scheduled ? 'scheduled' : values.start ? 'start' : 'scheduled',
      fields: {
        title,
        status: /[xX]/.test(status) ? 'done' : status === '-' ? 'canceled' : 'todo',
        when: values.scheduled || values.start || null,
        deadline: values.due || null,
        ...(values.created ? { created: values.created } : {}),
        ...(values.completion || values.cancelled
          ? { completed: values.cancelled || values.completion }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

function scan(text) {
  const tasks = [],
    invalid = [],
    lists = [];
  let offset = 0,
    fence = null,
    yaml = false,
    comment = false;
  for (const [number, raw] of text.split('\n').entries()) {
    const line = raw.replace(/\r$/, '');
    const structural = line.replace(/^(?:[ \t]*>[ \t]?)+/, '');
    const expanded = structural.replaceAll('\t', '    ');
    const indent = expanded.match(/^ */)[0].length;
    const list = expanded.match(/^ *(?:[-+*]|\d+[.)])[ \t]+/);
    if (structural.trim() && !fence)
      while (lists.length && indent <= lists.at(-1).indent) lists.pop();
    const ancestor = lists.at(-1);
    const code = indent >= (ancestor?.content ?? 0) + 4;
    if (number === 0 && line === '---') yaml = true;
    else if (yaml) {
      if (line === '---') yaml = false;
    } else {
      const oldFence = fence;
      if (!code || fence) fence = nextFence(fence, ancestor ? structural.trimStart() : structural);
      const visible = structural.replace(/(`+).*?\1/g, '');
      const inComment = comment || visible.trimStart().startsWith('<!--');
      if (!oldFence && !fence && !code) {
        const opened = visible.lastIndexOf('<!--'),
          closed = visible.lastIndexOf('-->');
        if (opened >= 0 || closed >= 0) comment = opened > closed;
      }
      if (!oldFence && !fence && !inComment && !code) {
        const parsed = parseLine(line);
        if (parsed) tasks.push({ ...parsed, from: offset, to: offset + line.length, number });
        else if (heading.test(line))
          invalid.push({ from: offset, to: offset + line.length, number });
        if (list) lists.push({ indent, content: list[0].length });
      }
    }
    offset += raw.length + 1;
  }
  return { tasks, invalid };
}
function baseline(meta) {
  return Object.fromEntries(
    ['title', 'status', 'when', 'deadline', 'created', 'completed'].map((key) => [
      key,
      meta[key] ?? null,
    ]),
  );
}
function restore(task) {
  const history = task.meta.conversion;
  if (history?.version !== 1) throw new Error('No supported conversion history');
  const source = parseLine(history.line);
  if (!source || !history.baseline) throw new Error('Invalid conversion history');
  const before = history.baseline,
    meta = task.meta;
  // Refuse destructive export when new ThingsMD-only data has no source
  // representation. Keep the task file rather than silently discarding it.
  const known = new Set([
    'title',
    'status',
    'when',
    'deadline',
    'created',
    'completed',
    'type',
    'id',
    'conversion',
    'checklist',
    'is_waiting',
    'evening',
    'order',
    'listOrder',
    'project',
    'deadlineDeferredOn',
    'loggedAt',
    'deleted',
    'deletedAt',
    'deletedFrom',
    'repeat',
    'repeatSource',
    'repeatDate',
    'repeatEpoch',
  ]);
  if (
    Object.keys(meta).some((key) => !known.has(key)) ||
    meta.repeat ||
    meta.repeatSource ||
    meta.is_waiting ||
    meta.evening ||
    meta.when === 'someday'
  )
    throw new Error('Task has ThingsMD-only metadata that cannot be restored safely');
  if (
    typeof meta.title !== 'string' ||
    !meta.title.trim() ||
    !['todo', 'done', 'canceled'].includes(meta.status)
  )
    throw new Error('Invalid task title or status');
  if (meta.deadline && !validDate(meta.deadline)) throw new Error('Invalid deadline');
  if (meta.when && !['today', 'anytime'].includes(meta.when) && !validDate(meta.when))
    throw new Error('Invalid schedule');
  const edits = [];
  const additions = [];
  const setDate = (key, value) => {
    const token = source.tokens.find((t) => t.key === key);
    if (token)
      edits.push(
        value
          ? { from: token.valueFrom, to: token.valueTo, text: value }
          : { from: token.from, to: token.to, text: '' },
      );
    else if (value)
      additions.push(
        source.format === 'dataview' ? `[${key}:: ${value}]` : `${canonical[key]} ${value}`,
      );
  };
  const day = (value) => (validDate(value?.slice(0, 10)) ? value.slice(0, 10) : null);
  if (meta.title !== before.title) {
    if (/[\r\n]/.test(meta.title || '')) throw new Error('Task title must fit on one line');
    let cursor = 0,
      inserted = false;
    for (const token of [
      ...source.tokens,
      { from: source.content.length, to: source.content.length },
    ]) {
      const segment = source.content.slice(cursor, token.from);
      if (segment.trim()) {
        const leading = segment.match(/^\s*/)[0];
        const trailing = segment.match(/\s*$/)[0];
        edits.push({
          from: cursor,
          to: token.from,
          text: leading + (inserted ? '' : meta.title) + trailing,
        });
        inserted = true;
      }
      cursor = token.to;
    }
  }
  if (meta.deadline !== before.deadline) setDate('due', day(meta.deadline));
  if (meta.when !== before.when)
    setDate(
      source.scheduleKey,
      meta.when === 'today' || meta.when === 'evening' ? today() : day(meta.when),
    );
  if (meta.created !== before.created) setDate('created', day(meta.created));
  if (meta.status !== before.status || meta.completed !== before.completed) {
    setDate('completion', meta.status === 'done' ? day(meta.completed) : null);
    setDate('cancelled', meta.status === 'canceled' ? day(meta.completed) : null);
  }
  let content = source.content;
  for (const edit of edits.sort((a, b) => b.from - a.from))
    content = content.slice(0, edit.from) + edit.text + content.slice(edit.to);
  if (additions.length) {
    const block = content.match(/\s+\^[a-zA-Z0-9-]+$/);
    const at = block ? block.index : content.length;
    content = content.slice(0, at) + ' ' + additions.join(' ') + content.slice(at);
  }
  const status =
    meta.status === before.status
      ? source.status
      : meta.status === 'done'
        ? 'x'
        : meta.status === 'canceled'
          ? '-'
          : ' ';
  let result = `${source.indent}${source.marker}${source.gap}[${status}]${source.space}${content}`;
  const checklist = (meta.checklist || [])
    .map((item) => {
      if (/[\r\n]/.test(item.text)) throw new Error('Checklist text must fit on one line');
      return `- [${item.done ? 'x' : ' '}] ${item.text}`;
    })
    .join('\n');
  const body = [task.body?.replace(/\r\n/g, '\n').replace(/\n$/, ''), checklist]
    .filter(Boolean)
    .join('\n\n');
  if (body) {
    const indent = source.indent + ' '.repeat(source.marker.length + source.gap.length);
    result +=
      '\n' +
      body
        .split('\n')
        .map((line) => indent + line)
        .join('\n');
  }
  return result;
}
module.exports = { parseLine, scan, baseline, restore };
