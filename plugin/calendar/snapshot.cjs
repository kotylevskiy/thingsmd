// Immutable cache names carry a timestamp and, after replacement, a source
// namespace. The namespace separates sources; it does not order sync versions.
const SNAPSHOT =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_[a-zA-Z0-9-]+(?:_s-([a-zA-Z0-9-]{1,80}))?\.ics$/;
const stamp = (time) => new Date(time).toISOString().replace(/[:.]/g, '-');
module.exports = { SNAPSHOT, stamp };
