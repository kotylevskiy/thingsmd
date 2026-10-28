// Finished states share lifecycle policy but retain their distinct meaning on disk.
const isFinished = (meta) => meta?.status === 'done' || meta?.status === 'canceled';
module.exports = { isFinished };
