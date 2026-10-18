import { waitForAsync } from './wait-for-async.mjs';
// Exercise the configured native editor flow and return to the same expanded card.
export async function editTaskNotes(page, body) {
  await page.locator('.workspace-leaf.mod-active .ot-task.is-expanded .ot-title-input').waitFor();
  const previous = await page.evaluate(async () => {
    const id = document.querySelector('.workspace-leaf.mod-active .ot-task.is-expanded')?.dataset
      .taskId;
    const task = (await app.plugins.getPlugin('thingsmd').taskRecords()).find(
      (task) => task.meta.id === id,
    );
    return { leaf: app.workspace.activeLeaf.id, id, path: task.file.path };
  });
  await page
    .locator('.workspace-leaf.mod-active .ot-task.is-expanded .ot-title-input')
    .press('Tab');
  await waitForAsync(
    page,
    (previous) =>
      !app.plugins.getPlugin('thingsmd').taskNotesOpening &&
      app.workspace.activeLeaf.view.file?.path === previous.path,
    previous,
  );
  await page.evaluate(
    async ({ body }) => {
      const leaf = app.workspace.activeLeaf;
      const view = leaf.view;
      const text = view.editor.getValue();
      const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
      view.editor.setValue(frontmatter + body);
      await view.save();
    },
    { body, previous },
  );
  const sameTab = await page.evaluate(
    (previous) => app.workspace.activeLeaf.id === previous.leaf,
    previous,
  );
  if (sameTab) await page.keyboard.press('Meta+Alt+ArrowLeft');
  else
    await page.evaluate(async (previous) => {
      app.workspace.activeLeaf.detach();
      let original;
      app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.id === previous.leaf) original = leaf;
      });
      await app.workspace.revealLeaf(original);
      app.workspace.setActiveLeaf(original, { focus: true });
    }, previous);
  await page
    .locator(`.workspace-leaf.mod-active .ot-task[data-task-id="${previous.id}"]:visible`)
    .dblclick();
}
