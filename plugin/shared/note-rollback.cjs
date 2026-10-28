// Compensate only unchanged writes. Every writer must compare `after` before
// restoring `before`; conflicts are reported rather than overwriting new edits.
async function rollbackNotes(edits, write) {
  const failures = [];
  for (const { file, before, after } of [...edits].reverse()) {
    if (before === after) continue;
    try {
      await write(file, after, before);
    } catch (error) {
      failures.push(`${file.path}: ${error.message}`);
    }
  }
  return failures;
}
function recoveryError(error, failures) {
  return failures.length
    ? new Error(`${error.message} Recovery needed: ${failures.join('; ')}`)
    : error;
}
module.exports = { rollbackNotes, recoveryError };
