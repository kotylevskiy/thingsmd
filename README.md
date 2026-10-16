# ThingsMD

A Things-inspired personal task manager for Obsidian, with native Markdown notes and inline task cards.

Things by Cultured Code is one of the greatest task managers I have ever used. ThingsMD is not affiliated with or endorsed by Cultured Code.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from a GitHub Release. Put all three files in `<vault>/.obsidian/plugins/thingsmd/`, reload Obsidian, then enable **ThingsMD** under Settings → Community plugins. Enable community plugins if Restricted mode is on. The GitHub source-code ZIP is not the installable build.

Alternatively, install through BRAT, an Obsidian community plugin, by adding this repository’s GitHub URL. BRAT is optional; ThingsMD has no dependency on it.

## Notes and tasks

- Any Markdown note can contain tasks. Type `+` and press space on an empty line in Live Preview to create a task immediately.
- Alternatively, use the command palette or the dedicated button to create tasks.
- Live Preview and Reading view render standalone `![[.thingsmd-storage/ID]]` references as interactive task cards. Source Mode retains the references as text.
- Click to select; double-click or press Enter to edit. Pressing Enter in the title field saves the task, closes the editor, and selects the task; pressing Tab moves to the notes field. Notes support multiline text and store Markdown, but do not render it inside the card.
- Drag a task within a note to reorder it. Drag it between lists and notes to move it.

## Lists and capture

- Inbox contains unassigned, unreferenced, unscheduled tasks without deadlines.
- Today includes tasks with an explicit `when: today` setting, start dates that have been reached, and deadlines that are due or overdue. Today is a persistent planning choice; choosing a date replaces it. Deadlines remain independent.
- Anytime excludes Inbox, future-start tasks, and Someday. Today tasks also appear here. Anytime and Someday group tasks by note; click a group heading to open the note, or Cmd/Ctrl-click for a new tab.
- Upcoming shows the next seven days, including empty days, followed by later populated dates, with a task shown on both its future start date and deadline (one row when they coincide).
- By default, completed tasks remain checked in place for the current local day, then appear in Logbook. Logging frequency is configurable. Restore reopens them at their retained positions.
- Pressing Backspace/Delete on a selected task moves it to Trash without removing its file or note references. Restore preserves its prior placement and state. Trash retention is configurable; by default, tasks are never deleted.

## Storage

Tasks are separate Markdown files in `.thingsmd-storage/` at the vault root, accessed through the vault adapter because Obsidian does not index dotfolders. Metadata includes a stable ID, title, status, project note path, ordering, optional When and Deadline values, a checklist, and completion/deletion timestamps. The order of references controls task placement in native notes.

Hidden task writes are serialized locally and checked for conflicting edits; conflicts keep the draft open. External changes are detected by polling. Deployment never seeds or replaces vault notes.
