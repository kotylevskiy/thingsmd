# Calendar Integration

Display read-only calendar events in Today, separate from tasks. Use one
implementation for Obsidian desktop, iOS and Android. The external calendar is
authoritative; the vault stores snapshots shared between devices.

## Calendar access

| Option                       | Requirements                                                           | Suitability                                                                            |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| macOS system-calendar helper | Native helper and calendar permission                                  | macOS only; additional installation and maintenance.                                   |
| Provider OAuth API           | App registration, authorization and token management                   | Portable, but requires provider-specific integrations.                                 |
| CalDAV                       | Calendar discovery, DAV requests and provider-dependent authentication | Standard protocol, but more setup and implementation work.                             |
| **ICS via secret link**      | Subscription URL and HTTP download                                     | **Selected:** standard format, shared parser, no separate login or OAuth registration. |

ICS subscriptions provide the simplest portable access for the read-only scope.
Each download returns a published snapshot; providers control its contents.
The URL grants access and must remain secret. Provider support is documented
below; findings are based on documentation/source inspection, not live accounts.

- **Google Calendar:** [secret ICS link](https://support.google.com/calendar/answer/37648); organization administrators may disable it.
- **iCloud:** [Public Calendar link](https://support.apple.com/guide/calendar/share-calendars-icl32362/mac); readable by link holders (the same as Google).
- **Nextcloud:** public ICS links with secure random 16-character tokens (inspected 33.0.10).
- **ownCloud Classic:** public ICS links with secure random 16-character tokens (inspected 10.16.6).
- **Radicale:** [token links](https://github.com/Kozea/Radicale/blob/v3.9.0/SHARING.md) since 3.7; administrator activation required. Tokens use two UUIDv4 values (inspected 3.9.0).
- **Baikal:** no stock secret public feed in 0.13.0; [publishing is unimplemented](https://github.com/sabre-io/dav/blob/4.7.1/lib/CalDAV/Backend/PDO.php#L1503).

> **PRIVATE / CONFIDENTIAL:** Nextcloud and ownCloud public feeds omit private events
> and redact confidential details; no standard per-link override exists.
> Radicale normal read shares retain details. Google's secret feed included private
> events in a [2023 test](https://wordpress.org/support/topic/public-and-private-events/);
> current behavior and iCloud handling remain unverified.
> Sources: [Nextcloud filtering](https://github.com/nextcloud/server/blob/v33.0.10/apps/dav/lib/CalDAV/PublicCalendar.php),
> [redaction](https://github.com/nextcloud/server/blob/v33.0.10/apps/dav/lib/CalDAV/CalendarObject.php),
> [ownCloud filtering](https://github.com/owncloud/core/blob/v10.16.6/apps/dav/lib/CalDAV/Calendar.php),
> [redaction](https://github.com/owncloud/core/blob/v10.16.6/apps/dav/lib/CalDAV/CalendarObject.php).

## Secret storage

Use Obsidian's [SecretStorage and SecretComponent](https://docs.obsidian.md/plugins/guides/secret-storage).

- Store the entire subscription URL as a named secret; settings contain only its name.
- Select or create the secret through the standard SecretComponent control.
- Configure the same secret name on each device that refreshes the calendar. Secret values remain local to the device and vault.
- Devices without the secret can display synchronized snapshots but cannot refresh them.
- SecretStorage requires Obsidian 1.11.4+; desktop encryption at rest starts in [1.11.5](https://obsidian.md/changelog/2026-01-20-desktop-v1.11.5/). Do not fall back to storing URLs in plain settings.

## Parsing

Use [`ical.js`](https://github.com/kewisch/ical.js) for parsing and recurrence
calculation. Browser compatibility and no runtime dependencies suit a shared
mobile/desktop implementation. Adoption remains subject to provider/mobile tests.
Its default package has no registered timezone database; bundle standard timezone
data for feeds that omit definitions.

- **Download the published feed without date parameters:** server-side filtering is not universal. Select Today locally.
- **Preserve recurrence rules and exceptions:** an old series can still contain today's events. Expand only the displayed period.
- **Display supplied private events:** the source already determines access.

### Timezones

- Use the feed's `VTIMEZONE` definitions first; fall back to bundled standard timezone data for recognized zone names.
- Interpret UTC timestamps directly and floating times in the device's local timezone, matching Today.
- Preserve all-day events as calendar dates without timezone conversion.
- Report unresolved timezone names instead of silently guessing an offset; retain the last valid snapshot.

## Snapshots and multiple devices

Immutable snapshots allow independent refreshes without overwriting one shared
file. The external calendar remains authoritative; event-level merging and
deletion tombstones are unnecessary.

- **Filename:** UTC fetch timestamp plus unique suffix, preventing device collisions.
- **Retention:** latest three valid snapshots per calendar; delayed cleanup and a soft limit allow synchronization to settle.
- **Selection:** newest valid snapshot by filename timestamp; fall back if unreadable or incompletely synced.
- **Display:** one snapshot at a time, preventing deleted events from returning through a merge with older data.
- **Unchanged response:** no new file for identical content or `304`. HTTP validators remain associated with the body they validate; refresh state can stay local.
- **Empty feed:** a valid empty snapshot displays no events; a failed download retains the cache.

Timestamp ordering is approximate because device clocks and provider caches can
differ. This limitation is accepted to keep synchronization simple.

## Refreshing

- **15 minutes ±60 seconds, configurable per calendar:** balance freshness and request load; jitter spreads device requests.
- **Refresh on show/resume when due, plus manual refresh:** mobile background execution is not guaranteed.
- **Respect provider hints and rate limits; back off after failures:** avoid excessive requests. Nextcloud [defaults to a four-hour hint](https://github.com/nextcloud/server/blob/v33.0.10/apps/dav/lib/CalDAV/ICSExportPlugin/ICSExportPlugin.php).
- **Use `ETag`/`Last-Modified` and `304` when supported:** reduce unchanged downloads. Real-provider support requires validation.
- **Show cached data immediately; retain it on failure:** preserve offline access and avoid blanking Today after network errors.

## Testing

ICS fixtures are in `tests/fixtures/calendar/`. See [fixture notes](../tests/fixtures/calendar/SOURCES.md)
for sample contents and test dates.

Serve them locally from the repository root:

```sh
python3 -B -m http.server 8765 --bind 127.0.0.1 --directory tests/fixtures/calendar
```

Use `http://127.0.0.1:8765/ical-js/minimal.ics` as a test subscription URL.
Other fixture files are available under the same server root.
