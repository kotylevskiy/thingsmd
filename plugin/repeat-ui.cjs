const { Modal, Menu, Notice } = require('obsidian');
const { button } = require('./dom.cjs');
const RepeatDialog = require('./repeat-dialog.cjs');

function install(plugin) {
  const find = async (id) => (await plugin.taskRecords()).find((t) => t.meta.id === id);
  plugin.showRepeatingTask = async (id) => {
    const task = await find(id);
    if (!task) {
      new Notice('This task is no longer available.');
      return;
    }
    const { isLogged } = require('./model.cjs');
    await plugin.openList(
      task.meta.deleted
        ? 'trash'
        : isLogged(task.meta, undefined, plugin.settings.logbook)
          ? 'logbook'
          : 'repeating',
    );
    const view = plugin.app.workspace.activeLeaf.view;
    view.selectTask(id);
    await view.openTask(id);
    view.contentEl.querySelector(`[data-task-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  plugin.showRepeat = async (id) => {
    const task = await find(id);
    if (!task) return;
    if (task.meta.repeatSource) {
      await plugin.showRepeatingTask(task.meta.repeatSource);
      return;
    }
    plugin.openDialog(RepeatDialog, task);
  };
  plugin.repeatMenu = async (id, event) => {
    const generation = plugin.beginTaskMenu();
    const task = await find(id);
    if (!task) return;
    if (task.meta.repeatSource) {
      await plugin.showRepeatingTask(task.meta.repeatSource);
      return;
    }
    if (!task.meta.repeat) {
      plugin.openDialog(RepeatDialog, task);
      return;
    }
    const menu = new Menu(),
      rule = task.meta.repeat;
    menu.setUseNativeMenu(false);
    const item = (title, action, disabled = false) =>
      menu.addItem((i) =>
        i
          .setTitle(title)
          .setDisabled(disabled)
          .onClick(() => Promise.resolve(action()).catch((e) => new Notice(e.message))),
      );
    item('Edit Rule…', () => plugin.showRepeat(id));
    item(
      'Create Next Copy',
      async () => {
        const copy = await plugin.repeating.createNext(id);
        await plugin.showRepeatingTask(copy.meta.id);
      },
      !rule.next,
    );
    item('Show Previous Copy', () => plugin.showRepeatingTask(rule.lastCopy), !rule.lastCopy);
    menu.addSeparator();
    item(rule.paused ? 'Resume' : 'Pause', () => plugin.repeating.pause(id, !rule.paused));
    item('Stop', () => plugin.repeating.stop(id));
    plugin.presentTaskMenu(menu, event, generation);
  };
  plugin.chooseRepeatReschedule = () =>
    new Promise((resolve) => {
      class Choice extends Modal {
        constructor(owner) {
          super(owner.app);
        }
        onOpen() {
          this.setTitle('Reschedule Repeating To-Do');
          this.contentEl.createEl('p', {
            text: 'Move only the next copy, or change the repeating rule for future copies?',
          });
          const actions = this.contentEl.createDiv('ot-repeat-actions');
          for (const [value, label] of [
            ['cancel', 'Cancel'],
            ['exception', 'Make Exception'],
            ['rule', 'Update Rule'],
          ])
            button(actions, label, () => {
              this.result = value;
              this.close();
            });
        }
        onClose() {
          resolve(this.result || 'cancel');
        }
      }
      plugin.openDialog(Choice);
    });
  plugin.addCommand({
    id: 'show-repeating',
    name: 'Show Repeating',
    callback: () => plugin.openList('repeating'),
  });
}
module.exports = { install };
