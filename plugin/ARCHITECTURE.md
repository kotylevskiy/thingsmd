# Plugin boundaries

`main.js` composes the services and registers host integrations. Modules accept the
plugin instance where they need Obsidian lifecycle registration or shared services;
pure policy modules do not import Obsidian. The ESLint boundary rule enforces that
separation for the policy layer.

## Source layout

| Location      | Responsibility                                                                       |
| ------------- | ------------------------------------------------------------------------------------ |
| `tasks/`      | Task logic, recurrence, capture, editing, folders, transfers and archives            |
| `lists/`      | List views, membership, ordering, counts, rows and drag handling                     |
| `notes/`      | Task-note controls, references, Live Preview and Reading-view integration            |
| `conversion/` | Source syntax, reversible task conversion, contextual actions and vault confirmation |
| `calendar/`   | Read-only calendar subscriptions, snapshots and event display                        |
| `search/`     | Search UI and model                                                                  |
| `settings/`   | Settings UI, validation, persistence and hotkey configuration                        |
| `shared/`     | Checked note access, write queue, Markdown helpers, date utilities and reusable UI   |

The root retains plugin composition, command routing, sidebar/navigation, identifier
migrations, shared styles and this document. Feature-specific UI stays with its
feature; shared modules serve multiple features. Filenames remain explicit within
folders. Tests stay in `tests/`; browser fixtures load plugin modules recursively.

## Module responsibilities

| Responsibility                                                 | Modules                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Task persistence and optimistic conflict checks                | `task-store`, `note-access`, `write-queue`                                     |
| Markdown structure and task placements                         | `markdown-document`, `markdown-fence`, `task-references`                       |
| Scheduling, repetition, list membership and presentation rules | `task-status`, `task-schedule`, `repeat-model`, `model`, `task-presentation`   |
| Settings validation and persistence                            | `settings-model`, `settings-service`                                           |
| Multi-file operations and recovery                             | `task-transfer-service`, `task-folder`, `archives`, `note-rollback`            |
| Shared task form and checklist interaction                     | `task-editor`, `checklist-editor`, `task-capture`                              |
| List and embedded-card hosts                                   | `list-view`, `native-editor`, `native-task-card`, `reading-drag`               |
| Native task-note augmentation                                  | `task-note-title`, `task-note-controls`, `task-note-frontmatter`, `task-notes` |
| Command and context-menu routing                               | `commands`, `task-menu`, `task-controller`                                     |

## Writes and drafts

Task controls edit a metadata snapshot. `task-store` serializes writes per task
and merges only the changed fields; conflicting external changes are rejected.
`note-access` reads live source buffers, rejects divergent drafts in multiple tabs,
and checks the expected text before writing. Use this access layer for note edits,
including Reading-view operations, rather than writing directly to the vault.

Task scans group documents by their frontmatter ID. `task-identity` elects the exact
`<id>.md` filename, then the shortest filename, with locale-independent lexical
ties. Only that version participates in task lists and automation; the other
records remain attached as conflict evidence without being changed or deleted.
List notices consider membership of both the selected version and the extra
copies. Writes recheck selection so a draft opened before sync cannot modify an
extra copy or silently redirect itself to the newly selected document. This is a
document-selection heuristic, not a merge of offline edits or a sync transaction.

Native Obsidian owns Markdown body editing. The public editor-extension bridge in
`task-note-frontmatter` applies checked metadata updates without replacing the
whole editor document or moving its scroll position. Task title drafts have a
separate lifetime from the recycled heading DOM, so navigation does not silently
discard a failed save.

Multi-file operations record before/after snapshots before attempting a write.
`note-rollback` restores those edits in reverse order through the same checked
writer. Recovery never overwrites a newer external edit; failures identify the
files that need attention. This is compensating recovery, not a filesystem-wide
transaction.

## Finished tasks and native references

`task-status` defines the shared finished-state predicate. `done` and `canceled`
share completion timestamps, archive timing, repetition advancement and progress,
but presentation keeps checkmarks separate from canceled X markers. Reopening
clears completion and logging metadata through `task-actions`; storage retains
optimistic conflict checks for both status and timestamp.

`task-reference-deletion` identifies standalone task boundaries without host
imports. Live Preview intercepts deletion before CodeMirror edits the hidden
reference and delegates to the same Trash action as list rows. It never replaces
the note buffer. Source mode remains native Markdown editing.

`system-locale` resolves the OS locale at the host boundary; the date-picker model
contains pure week-start policy and the compatibility fallback. Project navigation
resolves actual note references again before opening, so stale menu destinations
cannot silently open the wrong task location.

## Vault calendar

`vault-time` resolves calendar days and midnight in the vault's saved time zone,
including daylight-saving changes. First setup saves the system time zone;
subsequent loads retain the vault preference. Automatic archive stamps and repeat
creation stamps use the planned boundary, not the processing device's clock.
Logbook visibility and completion-based recurrence use that same calendar.
Manual actions keep their actual timestamps; ordinary Today/date-picker choices
continue to use the device's local calendar.

## Host lifetimes

Cards own their drafts and interaction listeners. Hosts own mounting, refresh and
disposal. Markdown render children, editor extensions and plugin registrations
must release observers/listeners when their owner unloads. Keep render-section
state weakly referenced; do not retain full note text in a global render cache.

Native editor and Reading view have different layout ownership. In particular,
Reading view measures its frontmatter section even when its contents are hidden;
keep that wrapper in layout so task controls and body share one correct scrollbar.

## Compatibility and verification

`legacy-identifiers` and `identifier-migration` are active upgrade paths, not
abandoned naming. Preserve their historical literals until migration support is
explicitly retired.

Run `npm run check` and `npm run build`. Use a marked disposable vault and separate
Obsidian profile for `npm run test:all-ui`; its drivers run sequentially. Unit tests
cover policy/conflict behavior, real Obsidian suites cover host integration, and
WebKit fixtures cover portable layout/interaction. Mobile emulation is not a test
on a physical device.

## Task format conversion

`conversion/format` is host-independent: it identifies checkbox tasks, parses source
fields, and patches only changed supported fields during restoration. Original
syntax and the initial ThingsMD values travel with each task in conversion metadata.
`conversion/service` plans against source snapshots, coordinates checked note writes,
and restores every occurrence before deleting a converted task file. It uses the
existing task queue, note access, and compensating rollback layers. Active task drafts
and conflicting edits prevent destructive restoration.

`conversion/settings` owns the vault-wide confirmation; `conversion/ui` owns note
and selection actions. `conversion/references` guards links that cannot become
standalone checkbox items. Shared labels and skip notices live in
`conversion/presentation`.

The conversion UI keeps only availability flags in its vault index. Reading-view
selection uses weakly held render-section source positions; it does not guess offsets
from displayed task titles. The settings section is last, and vault-wide confirmation
executes the reviewed plan rather than silently expanding its scope.
