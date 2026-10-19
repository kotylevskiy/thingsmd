const { dayKey, date, addDays, parseDate, validDate } = require('./local-date.cjs');

// CLDR territory exceptions; all remaining regions start their week on Monday.
const SUNDAY_REGIONS = new Set(
  'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW'.split(
    ' ',
  ),
);
const SATURDAY_REGIONS = new Set('AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'.split(' '));
function firstWeekday(
  locale = new Intl.DateTimeFormat().resolvedOptions().locale,
  Locale = Intl.Locale,
) {
  try {
    const info = new Locale(locale);
    const day = (info.getWeekInfo?.() || info.weekInfo)?.firstDay;
    if (Number.isInteger(day) && day >= 1 && day <= 7) return day % 7;
    const region = info.region || info.maximize?.().region;
    if (region === 'MV') return 5;
    return SATURDAY_REGIONS.has(region) ? 6 : SUNDAY_REGIONS.has(region) ? 0 : 1;
  } catch {
    const region = String(locale).match(/[-_]([A-Z]{2})(?:$|-)/)?.[1];
    return region === 'MV'
      ? 5
      : SATURDAY_REGIONS.has(region)
        ? 6
        : SUNDAY_REGIONS.has(region)
          ? 0
          : 1;
  }
}
function calendarDays(start, count, weekStart) {
  const offset = (date(start).getDay() - weekStart + 7) % 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i - offset));
}
function dateSuggestions(query, now = new Date(), locale) {
  const text = query.trim().toLocaleLowerCase(locale).replace(/\s+/g, ' ');
  if (!text) return [];
  const today = dayKey(now);
  const format = (key) =>
    new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date(key));
  const result = [];
  const add = (key, label = format(key)) => {
    if (validDate(key) && !result.some((item) => item.date === key))
      result.push({ date: key, label });
  };
  for (const [words, offset, label] of [
    [['today', 'сегодня'], 0, 'Today'],
    [['tomorrow', 'завтра'], 1, 'Tomorrow'],
    [['next week', 'через неделю'], 7, 'Next week'],
  ])
    if (words.some((word) => word.startsWith(text))) add(addDays(today, offset), label);
  const exact = parseDate(text, now);
  if (exact) {
    add(exact);
    return result;
  }
  const relative = text.match(
    /^(?:in\s*|через\s*)?(\d{1,4})\s*(d(?:ays?)?|w(?:eeks?)?|mo(?:nths?)?|y(?:ears?)?|д(?:ней|ня|ень)?|н(?:едел[юьи])?|м(?:есяц(?:а|ев)?)?|г(?:од(?:а)?|лет)?)?$/,
  );
  if (relative) {
    const amount = +relative[1];
    const unit = relative[2];
    const units = unit
      ? [
          unit[0] === 'm' || unit[0] === 'м'
            ? 'month'
            : /[wн]/.test(unit[0])
              ? 'week'
              : /[yг]/.test(unit[0])
                ? 'year'
                : 'day',
        ]
      : ['day', 'week', 'month'];
    for (const type of units) {
      const value = date(today);
      if (type === 'day' || type === 'week')
        value.setDate(value.getDate() + amount * (type === 'week' ? 7 : 1));
      else {
        // Month/year offsets clamp to the last day instead of overflowing it.
        const day = value.getDate();
        value.setDate(1);
        if (type === 'month') value.setMonth(value.getMonth() + amount);
        else value.setFullYear(value.getFullYear() + amount);
        value.setDate(
          Math.min(day, new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate()),
        );
      }
      add(dayKey(value), `In ${amount} ${type}${amount === 1 ? '' : 's'}`);
    }
    return result;
  }
  for (let i = 0; i < 7; i++) {
    const sample = new Date(2024, 0, 7 + i, 12);
    const names = ['long', 'short'].flatMap((weekday) =>
      [locale, 'en', 'ru'].map((language) =>
        new Intl.DateTimeFormat(language, { weekday })
          .format(sample)
          .toLocaleLowerCase(locale)
          .replace(/\.$/, ''),
      ),
    );
    const next = /^(?:next |следующ(?:ий|ая|ую) )/.test(text);
    const name = text.replace(/^(?:next |следующ(?:ий|ая|ую) )/, '');
    if (name.length < 2 || !names.some((word) => word.startsWith(name))) continue;
    let offset = (i - now.getDay() + 7) % 7 || 7;
    if (next) offset += 7;
    for (let week = 0; week < 3; week++) add(addDays(today, offset + week * 7));
  }
  for (let month = 0; month < 12; month++) {
    const names = ['long', 'short'].flatMap((style) =>
      [locale, 'en', 'ru'].map((language) =>
        new Intl.DateTimeFormat(language, { month: style })
          .format(new Date(2024, month, 1))
          .toLocaleLowerCase(locale)
          .replace(/\.$/, ''),
      ),
    );
    const match =
      text.match(/^(\p{L}+)[\s.-]*(\d{1,2})(?:[,\s]+(\d{4}))?$/u) ||
      text
        .match(/^(\d{1,2})[\s.-]*(\p{L}+)(?:[,\s]+(\d{4}))?$/u)
        ?.map((v, i, a) => (i === 1 ? a[2] : i === 2 ? a[1] : v));
    if (!match || !names.some((word) => word.startsWith(match[1]))) continue;
    const year = match[3] ? +match[3] : now.getFullYear();
    for (let y = year; y < year + (match[3] ? 1 : 4); y++) {
      const key = parseDate(`${y}-${month + 1}-${match[2]}`);
      if (key && (match[3] || key >= today)) add(key);
    }
  }
  return result.slice(0, 5);
}
module.exports = { firstWeekday, calendarDays, dateSuggestions };
