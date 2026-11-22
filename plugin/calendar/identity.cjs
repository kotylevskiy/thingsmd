function sourceIdentity(value) {
  if (!value || typeof value !== 'object') return undefined;
  const { salt, urlHash, uid = '', generation = '', retiredGenerations = [] } = value;
  if (
    typeof salt !== 'string' ||
    !/^[a-zA-Z0-9-]{16,128}$/.test(salt) ||
    typeof urlHash !== 'string' ||
    (urlHash !== '' && !/^[a-f0-9]{64}$/.test(urlHash)) ||
    typeof uid !== 'string' ||
    uid.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(uid) ||
    typeof generation !== 'string' ||
    (generation !== '' && !/^[a-zA-Z0-9-]{1,80}$/.test(generation)) ||
    !Array.isArray(retiredGenerations) ||
    retiredGenerations.some(
      (id) => typeof id !== 'string' || (id !== '' && !/^[a-zA-Z0-9-]{1,80}$/.test(id)),
    ) ||
    (!urlHash && !uid)
  )
    return undefined;
  const retired = [...new Set(retiredGenerations)].filter((id) => id !== generation);
  return {
    salt,
    urlHash,
    uid,
    generation,
    ...(retired.length ? { retiredGenerations: retired } : {}),
  };
}

const sourceKey = (source) => JSON.stringify(source || null);
const generation = (config) => config.source?.generation || '';

async function urlFingerprint(salt, normalizedUrl) {
  const bytes = new TextEncoder().encode(`${salt}\n${normalizedUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function newSource(normalizedUrl, uid = '', revision = '', retiredGenerations = []) {
  const salt = crypto.randomUUID();
  const retired = [...new Set(retiredGenerations)].filter((id) => id !== revision);
  return {
    salt,
    urlHash: await urlFingerprint(salt, normalizedUrl),
    uid,
    generation: revision,
    ...(retired.length ? { retiredGenerations: retired } : {}),
  };
}

async function sameUrl(source, normalizedUrl) {
  return !!source?.urlHash && source.urlHash === (await urlFingerprint(source.salt, normalizedUrl));
}

async function matchesSource(source, normalizedUrl, uid) {
  if (await sameUrl(source, normalizedUrl)) return true;
  return !!source?.uid && !!uid && source.uid === uid;
}

// Only established local secrets or a verified feed may establish a baseline.
// Never learn identity from an unverified URL pasted on a new device.
async function rememberSource(plugin, config, normalizedUrl, parsed) {
  const expected = sourceKey(config.source);
  if (config.source?.urlHash && (config.source.uid || !parsed.uid)) return;
  const next = config.source?.urlHash
    ? { ...config.source, uid: parsed.uid }
    : await newSource(
        normalizedUrl,
        config.source?.uid || parsed.uid,
        generation(config),
        config.source?.retiredGenerations,
      );
  await plugin.persistSettings((settings) => ({
    calendars: settings.calendars.map((current) =>
      current.id === config.id && sourceKey(current.source) === expected
        ? { ...current, source: next }
        : current,
    ),
  }));
  plugin.calendar.configure(plugin.settings.calendars);
}

module.exports = {
  sourceIdentity,
  sourceKey,
  generation,
  urlFingerprint,
  newSource,
  sameUrl,
  matchesSource,
  rememberSource,
};
