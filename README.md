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
