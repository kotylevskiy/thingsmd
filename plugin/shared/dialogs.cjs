// A plugin-scoped owner for transient dialogs. Closing removes the registration;
// unloading closes remaining dialogs so old handlers cannot survive a reload.
module.exports = function installDialogs(plugin) {
  const opened = new Set();
  plugin.openDialog = (Dialog, ...args) => {
    const dialog = new Dialog(plugin, ...args);
    const onClose = dialog.onClose?.bind(dialog);
    dialog.onClose = () => {
      opened.delete(dialog);
      onClose?.();
    };
    opened.add(dialog);
    dialog.open();
    return dialog;
  };
  plugin.register(() => {
    for (const dialog of opened) dialog.close();
    opened.clear();
    delete plugin.openDialog;
  });
};
