# Feature coverage

`npm run check` runs lint, formatting and unit regressions. `npm run build` bundles
the desktop/mobile plugin. `npm run test:all-ui` runs the UI drivers and local HTTP
calendar checks sequentially against a marked disposable vault. It stops at the
first failure unless `THINGSMD_CONTINUE_ON_FAILURE=1` is set.

UI coverage means real desktop Obsidian, phone/tablet viewport and touch emulation,
or isolated browser fixtures, as identified by each suite. WebKit fixtures are not
physical iPhone tests. Native Windows, Linux, Android and iOS execution needs separate
platform testing.

| Feature                                                          | Unit coverage (`tests/`)                                                                                     | Integration scripts (`npm run …`)                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reversible Tasks Emoji / Dataview conversion                     | `conversion-format`, `conversion-service`                                                                    | `test:conversion` (real Obsidian), `test:conversion-mobile` (mobile emulation), `test:conversion-webkit` (mocked host)                                                                        |
| Storage, concurrent edits, external changes, rollback            | `task-store`, `task-actions`, `note-access`, `note-rollback`, `transfer`, `archive-cleanup`                  | `test:storage`, `test:sync-safety`, `test:live-session`                                                                                                                                       |
| Lists, membership, counts, ordering, selection                   | `model`, `list-policy`, `list-counts`, `list-order`, `list-actions`, `inbox-session`, `thingsmd-list-parity` | `test:list-parity`, `test:inbox-today`, `test:ordering`, `test:list-counts`, `test:deselection`                                                                                               |
| Capture, daily notes, empty titles, drafts                       | `task-capture`, `task-editor`, `capture-entrypoints`                                                         | `test:capture`, `test:daily-capture`, `test:empty-title`, `test:draft-lifecycle`, `test:capture-layout`                                                                                       |
| Global capture and shortcut recording                            | `global-capture`, `global-capture-main`                                                                      | `test:global-capture`, `test:native-global-capture`, `test:global-hotkey-setting`                                                                                                             |
| Scheduling, deadlines, Evening, Waiting For                      | `dates`, `date-picker-model`, `waiting`, `waiting-indicator`, `task-indicators`                              | `test:scheduling`, `test:date-picker`, `test:waiting`, `test:waiting-option`, `test:waiting-settings`, `test:calendar-locale-webkit`                                                          |
| Recurring tasks and completion-based schedules                   | `repeat`, `task-actions`, `vault-time`                                                                       | `test:repeat`, `test:vault-time`, `test:vault-time-webkit`                                                                                                                                    |
| Completion, cancellation, Logbook, Trash, undo                   | `archive-policy`, `archive-cleanup`, `logbook-groups`, `trash-locations`, `task-reference-deletion`          | `test:archives`, `test:canceled-tasks`, `test:logbook-groups`, `test:task-deletion-undo`                                                                                                      |
| Markdown preservation and embedded cards                         | `markdown-document`, `task-reference-deletion`, `task-editor`                                                | `test:native`, `test:reading`, `test:native-refresh`, `test:controls`                                                                                                                         |
| Task notes, titles, controls, links, scrolling                   | `task-notes`, `task-editor`, `command-focus`                                                                 | `test:task-note-title`, `test:task-note-controls`, `test:task-note-scroll`, `test:task-note-matrix`, `test:task-note-states`, `test:task-note-title-webkit`, `test:task-note-controls-webkit` |
| Move, clipboard, drag and touch                                  | `transfer`, `transfer-notice`, `drag`, `list-row-drag`, `touch-tasks`, `task-menu`                           | `test:transfer`, `test:drag`, `test:touch`, `test:note-to-inbox`, `test:upcoming-move`, `test:menu`                                                                                           |
| Task folders and migrations                                      | `task-folder`, `calendar-home`, `identifier-migration`                                                       | `test:task-folder`, `test:task-folder-explorer`, `test:task-folder-webkit`, `test:identifier-migration`                                                                                       |
| Search and project navigation/progress                           | `search`, `project-navigation`, `project-progress`                                                           | `test:search`, `test:navigation`, `test:progress`                                                                                                                                             |
| Settings, persistence and time zones                             | `settings-service`, `vault-time`, `system-locale`                                                            | `test:settings`, `test:vault-time`, `test:vault-time-webkit`, `test:waiting-settings-webkit`                                                                                                  |
| Sidebar, commands, mobile navigation and unload                  | `sidebar-lifecycle`, `capture-entrypoints`, `command-focus`, `workspace-leaf`, `task-refresh`                | `test:sidebar-navigation`, `test:mobile-sidebar`, `test:mobile-navigation`, `test:commands`, `test:deferred-tabs`, `test:plugin-lifecycle`                                                    |
| Calendar creation, names, secret references, cancellation        | `calendar-create`, `calendar-service`, `settings-service`                                                    | `test:calendar`, `test:plugin-lifecycle`                                                                                                                                                      |
| ICS parsing, recurrence, exclusions, moved events, DST, colors   | `calendar-parser` (all 11 pinned upstream fixtures have explicit expectations)                               | `test:calendar`, `test:calendar-webkit`                                                                                                                                                       |
| Calendar snapshots, concurrent devices, offline cache, retention | `calendar-service` (shared-storage simulation)                                                               | `test:calendar` (real vault and localhost provider)                                                                                                                                           |
| Calendar HTTP, validators, errors, rate limits, timeout          | `calendar-service`, `calendar-create`                                                                        | `test:calendar-http` (real HTTP), `test:calendar` (Obsidian `requestUrl`)                                                                                                                     |
| Calendar settings, Today/Upcoming and task-draft preservation    | `settings-service` (concurrent calendar updates)                                                             | `test:calendar`, `test:calendar-upcoming` (desktop/mobile emulation), `test:calendar-webkit`                                                                                                  |
| Calendar source identity, device setup and confirmed replacement | `calendar-identity`, `calendar-subscription`, `calendar-settings-sync`                                       | `test:calendar`, `test:calendar-sync`, `test:calendar-webkit`                                                                                                                                 |
| Calendar refresh coordination and guarded cache deletion         | `calendar-refresh-coordinator`, `calendar-service`, `calendar-vault-storage`                                 | `test:calendar`, `test:calendar-sync`, `test:plugin-lifecycle`                                                                                                                                |

## Calendar provider checks

`npm run calendar:check-live` checks only the public links in
`fixtures/calendar/live-feeds.json`: Google, iCloud, Nextcloud and Radicale. It does
not read `.env`, store downloaded event bodies or require private calendar secrets.
These network-dependent checks remain opt-in. ownCloud does not currently have a
live provider fixture.

Malformed upstream samples are expected to fail validation; modified inputs used
to exercise a valid case are constructed in the test, preserving the pinned files.
Historical samples use controlled dates.

Cross-device snapshot convergence is tested with shared storage and simulated
interleavings. A real two-device Obsidian Sync session is not covered. The matrix
tracks feature coverage, not a claim of complete branch coverage or support for
every provider-specific ICS extension.
