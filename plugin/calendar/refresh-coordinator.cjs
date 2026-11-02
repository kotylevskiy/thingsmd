// Own refresh triggers separately from fetching and cache persistence. Settings
// reads stay serialized by the settings service; network requests never hold that lock.
class CalendarRefreshCoordinator {
  constructor(
    service,
    synchronize,
    {
      // Window timer APIs require their native receiver. Do not store them as
      // methods and call them with the coordinator as `this`.
      setTimer = (callback, delay) => setTimeout(callback, delay),
      clearTimer = (timer) => clearTimeout(timer),
    } = {},
  ) {
    Object.assign(this, { service, readSettings: synchronize, setTimer, clearTimer });
    this.disposed = false;
    this.polling = false;
  }
  async synchronize() {
    const changed = await this.readSettings();
    if (changed) this.schedule();
    return changed;
  }
  schedule() {
    if (this.disposed || this.service.disposed || this.service.moving) return;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.refresh();
    }, 0);
  }
  async refresh() {
    if (this.disposed || this.service.disposed || this.service.moving) return;
    try {
      await this.service.reload();
      if (!this.disposed) await this.service.refreshAll();
    } catch {
      // Settings/cache sync can be incomplete. Preserve the last valid cache;
      // a later foreground poll or explicit refresh retries the operation.
    }
  }
  async poll() {
    if (this.disposed || this.service.disposed || this.service.moving || this.polling) return;
    this.polling = true;
    try {
      await this.synchronize();
    } catch {
      // Invalid settings are surfaced by the service, never treated as an empty list.
    } finally {
      // Release after the settings read, so a slow download cannot delay new bindings.
      this.polling = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.clearTimer(this.timer);
  }
}
module.exports = { CalendarRefreshCoordinator };
