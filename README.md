# ThingsMD

A Things-inspired personal task manager for Obsidian, with native Markdown notes and inline task cards.

Things by Cultured Code is one of the greatest task managers I have ever used. ThingsMD is not affiliated with or endorsed by Cultured Code.

## Installation

Download `main.js`, `manifest.json`, and `styles.css` from a GitHub Release. Put all three files in `<vault>/.obsidian/plugins/thingsmd/`, reload Obsidian, then enable **ThingsMD** under Settings → Community plugins. Enable community plugins if Restricted mode is on. The GitHub source-code ZIP is not the installable build.

Alternatively, install through BRAT, an Obsidian community plugin, by adding this repository’s GitHub URL. BRAT is optional; ThingsMD has no dependency on it.

## Notes and tasks

- Any Markdown note can contain tasks. Type `+` and press space on an empty line in Live Preview to create a task immediately.
- Alternatively, use the command palette or the dedicated button to create tasks. Capture uses bottom Cancel and Save buttons on desktop and mobile. Save with Cmd/Ctrl+Enter or Enter in the title; Cancel and Escape discard the draft. Clicking or tapping outside leaves capture open and preserves the draft.
- Live Preview and Reading view render standalone `![[.thingsmd-storage/ID]]` references as interactive task cards. Source Mode retains the references as text.
- Use **Waiting For** in the task editor or creation dialog to toggle waiting status before saving.
- Click to select; double-click or press Enter to edit. Pressing Enter in the title field saves the task, closes the editor, and selects the task; pressing Tab moves to the notes field. Notes support multiline text and store Markdown, but do not render it inside the card.
- Drag a task within a note to reorder it. Drag it between lists and notes to move it.

## Lists and capture

- Inbox contains unassigned, unreferenced, unscheduled tasks, including tasks with deadlines. Deadline-only Inbox tasks stay out of Anytime and Upcoming; due deadlines still appear in Today. Tasks processed while viewing Inbox remain in a temporary “to-dos were moved out of the Inbox” section until you navigate away.
- Moving or rescheduling a task shows a brief notice naming where to find it.
- Today includes tasks with an explicit `when: today` setting, start dates that have been reached, and deadlines that are due or overdue. Today is a persistent planning choice; choosing a date replaces it. Deadlines remain independent.
- Anytime excludes Inbox, future-start tasks, and Someday. Today tasks also appear here. Anytime and Someday group tasks by note; click a group heading to open the note, or Cmd/Ctrl-click for a new tab.
- Upcoming shows the next seven days, including empty days, followed by later populated dates, with a task shown on both its future start date and deadline (one row when they coincide).
- By default, completed tasks remain checked in place for the current local day, then appear in Logbook. Logging frequency is configurable. Restore reopens them at their retained positions.
- Pressing Backspace/Delete on a selected task moves it to Trash without removing its file or note references. Restore preserves its prior placement and state. Trash retention is configurable; by default, tasks are never deleted.

## Storage

Tasks are separate Markdown files in `.thingsmd-storage/` at the vault root, accessed through the vault adapter because Obsidian does not index dotfolders. Metadata includes a stable ID, title, status, project note path, ordering, optional When and Deadline values, a checklist, and completion/deletion timestamps. The order of references controls task placement in native notes.

Hidden task writes are serialized locally and checked for conflicting edits; conflicts keep the draft open. External changes are detected by polling. Deployment never seeds or replaces vault notes.

## Development checks

Run `npm run check` for lint, formatting, and unit tests, followed by `npm run build`.
`npm run test:session-ui` exercises production capture/editor controls, sidebar recovery, and temporary Inbox rows in an isolated browser with a small Obsidian host stub. `npm run test:mobile-layout` checks phone task-row geometry and reproduces the previous wrapping bug. These browser tests do not open or modify a vault. They use installed Chrome on macOS; set `THINGSMD_CHROME_PATH` elsewhere, or install Playwright's Chromium. Create a disposable vault with `npm run dev:vault`. Tests against a running Obsidian instance require `THINGSMD_TEST_VAULT` pointing to that prepared vault. Deployment and UI drivers refuse unmarked directories and paths outside the system temporary directories, including symlinks to personal vaults. Set `THINGSMD_DEBUG_URL` to its isolated localhost debug endpoint (default: port 9222); `npm run test:live-session` covers the changes from this session in the actual app.


## Code structure

`plugin/main.js` composes services and exposes the small plugin facade used by Obsidian commands. The plain CommonJS modules keep the distribution dependency-free; the build follows local imports and bundles each module once.

- **Domain policies:** `model`, `lists`, `local-date`, `task-schedule`, `archive-policy`, `repeat-model`, and `search-model` have no Obsidian dependency. They decide membership, scheduling, ordering, retention, and repeat dates.
- **Persistence:** `task-store` owns hidden Markdown task files, serialization, and the shared per-task `WriteQueue`. `note-access` owns reads and optimistic writes to ordinary notes, preferring open editor buffers. `task-references` limits placement edits to standalone references outside frontmatter and code fences.
- **Application services:** `task-actions` merges draft changes and coordinates repeat decisions. `task-transfer-service` coordinates metadata and note placement with rollback. `repeat-engine` serializes repeat generation; deterministic copy IDs make retries idempotent. `archives` owns logging and permanent cleanup. `settings-service` publishes settings only after persistence succeeds.
- **UI adapters:** `task-transfer` translates clipboard and note-drop events into service calls. `task-menu`, `commands`, and `repeat-ui` select actions. `move-dialog` and `repeat-dialog` edit local UI state; `dialogs` owns their lifetime across plugin reloads.
- **Views:** `list-view` owns list selection and rendering; `list-row-drag` adapts mouse/touch gestures. `task-editor` owns the shared task draft. `native-task-card` owns the rendered card, focus, and key scopes; `native-editor` integrates it with CodeMirror and Reading mode. `date-picker` is shared across editing, moving, and repeat configuration.
- **Lifecycle:** `sidebar` owns file-explorer shortcuts, `sidebar-lifecycle` repairs them after mobile rebuilds, and `task-refresh` polls hidden files and coordinates background maintenance. Installers register cleanup with the plugin; views dispose their own gestures and drafts.

Keep policy changes in the domain modules and file writes in the services. UI code should pass user intent to those services rather than duplicate move or schedule logic. Tests cover conflict rejection, rollback, concurrent writes, reload cleanup, and UI behavior; mocks isolate boundaries, while the live suites exercise Obsidian's actual APIs.

`npm run test:all-ui` runs the UI suites sequentially against the same disposable renderer and writes a machine-readable report under `artifacts/`. It leaves Obsidian running. `npm run test:upcoming-move` covers date selection, touch-list dispatch, cancellation, and copying without rescheduling the original; `npm run test:repeat-layout` checks responsive Repeat controls.

Use `waitForAsync` from `scripts/wait-for-async.mjs` for asynchronous storage assertions. It polls the resolved condition; Playwright's `waitForFunction` treats a returned Promise as truthy. Lint rejects async callbacks passed to that API. Phone viewport and touch emulation cover responsive behavior, but do not replace testing on a physical iPhone.
