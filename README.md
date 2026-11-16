# ThingsMD

A Things-inspired personal task manager for Obsidian, with native Markdown notes and inline task cards.

Things by Cultured Code is one of the greatest task managers I have ever used. ThingsMD is not affiliated with or endorsed by Cultured Code.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from a GitHub release. Put all three files in `<vault>/.obsidian/plugins/thingsmd/`, reload Obsidian, and then enable **ThingsMD** under Settings → Community plugins. Enable community plugins if Restricted mode is on. The GitHub source-code ZIP is not the installable build.

Alternatively, install through BRAT, an Obsidian community plugin, by adding this repository’s GitHub URL. BRAT is optional; ThingsMD has no dependency on it.

## Tasks, Notes, and Capture

- Any Markdown note can contain tasks. Type `+` and press Space on an empty line in Live Preview to create a task immediately.
- Configure a global keyboard shortcut to capture tasks from anywhere (Obsidian must be running).
- Alternatively, use the command palette or the dedicated button to create tasks.
- Live Preview and Reading view render standalone `![[.thingsmd-storage/ID]]` references as interactive task cards. Source Mode retains the references as text.
- Click to select; double-click or press Enter to edit. Pressing Enter in the title field saves the task, closes the editor, and selects the task; pressing Tab moves to the notes field.
- Drag a task within a note to reorder it. Drag it between lists and notes to move it.

## Lists

- Inbox contains unassigned, unreferenced, unscheduled tasks.
- Today includes tasks explicitly planned for today, tasks whose start dates have arrived, and tasks with due or overdue deadlines.
- Anytime shows all tasks except those in Inbox or Someday and those with future start dates.
- Upcoming shows the next seven days, including empty days, followed by later populated dates. A Someday task with a future deadline also appears on its deadline date. Dragging to a different day changes the start date and preserves the deadline.
- Waiting For and its airplane badge are ThingsMD additions.
- By default, completed tasks remain checked in place for the current local day and then appear in Logbook. Logging frequency is configurable. Restore reopens them at their retained positions.
- Pressing Backspace/Delete on a selected task moves it to Trash without removing its file or note references. Restore preserves its prior placement and state. Trash retention is configurable; by default, tasks are never deleted.

## Storage

Tasks are separate Markdown files in `.thingsmd-storage/` at the vault root.

Task writes are serialized locally and checked for conflicting edits; conflicts keep the draft open. External changes are detected by polling. Deployment never seeds or replaces vault notes.

## Task format conversion

Convert Markdown checkboxes in Tasks Emoji or Dataview format into ThingsMD task files, and convert imported tasks back to their original format.

- Use the note menu or command palette to convert all eligible tasks in the current note.
- Select task text in Reading view or Live Preview and use the context menu to convert the touched tasks. Imported cards in notes also have a reverse-conversion action in their task menu. The action appears only when the selection contains eligible tasks. Ordinary note and selection conversions do not show a confirmation or success notification.
- **Conversion** is the last section in ThingsMD settings. Vault-wide conversion shows the number of tasks and affected notes and asks for confirmation. You can try a single note or selection first.
- Reverse conversion is available for previously imported tasks. It restores every standalone task reference across notes, including descriptions, then deletes the ThingsMD task files. Restored checkboxes are independent tasks.

Conversion preserves task-level source data, including fields ThingsMD does not interpret. Unchanged tasks return to their original syntax, including list markers, indentation, custom checkbox symbols, field order, and square-bracket or parenthesis notation. Supported fields edited in ThingsMD are updated when converting back. The original line and a metadata snapshot are stored in each task file's `conversion` property; no source-format setting is needed.

| Source data | Behavior in ThingsMD |
| --- | --- |
| Task text and completion | Editable; custom checkbox symbols are retained when their status is unchanged. `x`/`X` map to done and `-` to canceled; other symbols map to open tasks. |
| Due date | Maps to the deadline. |
| Scheduled and start dates | Scheduled date maps to the ThingsMD schedule; if absent, start date is used. When both exist, the separate start date is preserved. |
| Created, done, and canceled dates | Stored with the task; unchanged source date syntax is retained. |
| Priority, recurrence, dependencies, IDs, and on-completion instructions | Preserved without activating those features. For example, `[onCompletion:: delete]` will not delete a task when it is completed in ThingsMD. |
| Unknown inline fields | Preserved in the original source metadata. |

Both Emoji metadata and Dataview fields in `[]` or `()` are recognized. Plain checkboxes are accepted without a `#task` tag; newly added dates on those tasks use Emoji notation. Plugin-wide settings, global filters, inherited note properties, and custom status definitions are not imported.

Each checkbox is converted independently. Indentation is remembered for restoration, without creating task hierarchies. Surrounding prose and existing nested content stay in the source note. Descriptions and checklists added in ThingsMD are restored as indented Markdown beneath the checkbox.

Code examples and frontmatter are excluded. Malformed or ambiguous task fields are skipped and reported. Reverse conversion also retains tasks with ordinary prose links or links from other task notes, since those cannot safely become standalone checkboxes. Newly added ThingsMD-only data—such as Waiting For, Someday, Evening, native repeat rules, or custom YAML properties—must be cleared or copied elsewhere before reverse conversion; such tasks are skipped rather than deleted. Conversion checks source buffers and task files for concurrent edits and attempts checked rollback on failure; it never intentionally overwrites a newer external edit. A recovery error identifies files needing attention.

Format references: [Tasks Emoji format](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Reference/Task%20Formats/Tasks%20Emoji%20Format.md), [Dataview format](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Reference/Task%20Formats/Dataview%20Format.md), and [Dataview task metadata](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-tasks/).
