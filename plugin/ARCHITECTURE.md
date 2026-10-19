# Plugin boundaries

`main.js` composes the services and registers host integrations. Modules accept the
plugin instance where they need Obsidian lifecycle registration or shared services;
pure policy modules do not import Obsidian. The ESLint boundary rule enforces that
separation for the policy layer.

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
