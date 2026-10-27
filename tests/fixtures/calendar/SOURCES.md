# Calendar test fixtures

These are unmodified upstream test files, downloaded on 2026-10-28 and pinned to
the revisions below. They are parser/compatibility inputs, not proof that every
provider currently produces the same data. Some intentionally exercise invalid
or nonstandard input. Decide acceptance/rejection expectations explicitly when
adding tests; a file's presence here does not mean it must be accepted.

## ICAL.js samples

Source: [kewisch/ical.js samples](https://github.com/kewisch/ical.js/tree/33ba266282fac7c721d792e04124513df73fe140/samples).
Revision: `33ba266282fac7c721d792e04124513df73fe140`.
License: Mozilla Public License 2.0; original license in [ical-js/LICENSE](ical-js/LICENSE).
Attribution: ICAL.js upstream contributors. Files retain their upstream contents.

- [minimal.ics](ical-js/minimal.ics): Google-style event with an embedded
  `America/Los_Angeles` time-zone definition; event date is 2012-06-30.
- [duration_instead_of_dtend.ics](ical-js/duration_instead_of_dtend.ics): an event
  using `DURATION` instead of `DTEND`.
- [day_long_recur_yearly.ics](ical-js/day_long_recur_yearly.ics): all-day recurrence
  and alarms. Despite its upstream filename, the rule is **weekly on weekdays**,
  starting in 2012, with no end date.
- [recur_instances.ics](ical-js/recur_instances.ics): monthly recurrence, added and
  excluded dates, moved instances and folded lines. Also contains an explicitly
  invalid timezone and an unknown component; use as a compatibility/adversarial
  fixture rather than a strictly valid baseline.

## node-ical fixtures

Source: [jens-maus/node-ical fixtures](https://github.com/jens-maus/node-ical/tree/1930673781915be9aacadc50a504aac18282cde5/test/fixtures).
Revision: `1930673781915be9aacadc50a504aac18282cde5`.
License: Apache License 2.0; original license in [node-ical/LICENSE](node-ical/LICENSE).
Attribution: node-ical upstream contributors. Files retain their upstream contents.

- [daily-count-exdate-recurrence-id.ics](node-ical/daily-count-exdate-recurrence-id.ics):
  finite recurrence, exclusions and an overridden occurrence in July 2015. Also
  lacks standard calendar headers/timezone definitions and contains an override
  whose end precedes its start; test these quirks explicitly.
- [dst-transition-rules.ics](node-ical/dst-transition-rules.ics): embedded Amsterdam
  DST rules, but the event itself has floating times. Contains leading whitespace
  and unusual organizer data. It is not by itself a recurrence-across-DST test.
- [mixed-timezone-handling.ics](node-ical/mixed-timezone-handling.ics): floating,
  UTC, named-zone and date-only values, including an implicit/nonstandard date-only
  value. Named-zone fallback is needed; events are in October 2002.
- [whole_day_moved_over_dst_change_berlin.ics](node-ical/whole_day_moved_over_dst_change_berlin.ics):
  finite all-day series with a moved occurrence around 2024-10-27 through
  2024-10-30. The test must explicitly select the Berlin display timezone.
- [utf8-french-calendar.ics](node-ical/utf8-french-calendar.ics): accented text and
  ownCloud `VTODO` components. Contains **no events**; useful for ensuring calendar
  import does not accidentally convert feed tasks into ThingsMD tasks.
- [tentative-apple-calendar.ics](node-ical/tentative-apple-calendar.ics): macOS
  export with tentative, confirmed, canceled and unspecified-status events,
  folded attendee fields and timezone references. Dates are in July 2022.
- [badRRULE.ics](node-ical/badRRULE.ics): malformed recurrence properties alongside
  other events; use to test rejection without replacing a previously valid cache.

## Serve locally over HTTP

From the repository root, with Python 3.7 or newer:

```sh
python3 -B -m http.server 8765 --bind 127.0.0.1 --directory tests/fixtures/calendar
```

The server exposes only this fixture directory and listens on loopback. Stop it
with Ctrl+C. Example URLs:

- <http://127.0.0.1:8765/ical-js/minimal.ics>
- <http://127.0.0.1:8765/ical-js/day_long_recur_yearly.ics>
- <http://127.0.0.1:8765/node-ical/tentative-apple-calendar.ics>
- <http://127.0.0.1:8765/node-ical/badRRULE.ics>

Inspect a response:

```sh
curl -i http://127.0.0.1:8765/ical-js/minimal.ics
```

Repeat the request with the exact `Last-Modified` response value in an
`If-Modified-Since` header to obtain `304 Not Modified`. Request a nonexistent
filename to obtain `404`. Python serves the malformed fixture as an ordinary
`200`; the calendar reader must reject its content itself.

The built-in server supports `Last-Modified` conditional requests but does not
provide ETags or configurable `429`/`503`, delays or interrupted responses.
Use a controllable HTTP test harness for those cases during implementation; this
server is the minimal manual download/subscription setup, not the complete HTTP
acceptance suite. See [Python's HTTP server documentation](https://docs.python.org/3/library/http.server.html).

These are plain HTTP development URLs. Production secret feeds should still use
HTTPS. Actual phone transport/cleartext policies are a separate test: a phone's
`127.0.0.1` points to the phone, not this computer. Testing from a physical phone
requires a deliberately configured reachable host or HTTPS endpoint.

## Test dates and remaining cases

Use a controlled clock or an explicit display period for these historical files.
Do not bulk-shift their dates: doing so changes DST, recurrence and exception
relationships. Add separate synthetic, clearly attributed fixtures if a live
Today demo needs timed events relative to the current date.

Additional fixtures still needed for the full calendar suite include a valid
empty calendar, paired before/after snapshots for updates and deletions,
truncated responses, deterministic large-feed limits and HTTP failure scenarios.
Do not modify these upstream originals to simulate changes; make separate copies.
