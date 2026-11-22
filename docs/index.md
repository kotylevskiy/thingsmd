---
layout: thingsmd
---

<div class="section-block" id="reference" markdown="1">

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from **Assets** in the [latest release](https://github.com/kotylevskiy/thingsmd/releases/latest).
2. Put them in `.obsidian/plugins/thingsmd/` inside your vault and reload Obsidian.
3. In **Settings → Community plugins**, enable community plugins if prompted, then enable **ThingsMD**.

To update manually, replace the same three files and reload Obsidian.

Consider using the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) for automatic installation and updates.

{% include admonition.html id="recommended-theme" title="Recommended theme" body="In **Settings → Appearance → Themes → Manage**, search for [**Things**](https://community.obsidian.md/themes/things) by Colin Eckert and choose **Install and use**." %}

## Tasks

In any note, type `+` and press **Space** on a blank line in Live Preview to create a task. While editing the title, press **Tab** to edit the description.

The **ThingsMD: New task** command also files a task in the current project note.

### Task capture

On desktop, set **Global capture shortcut** in ThingsMD settings to capture from another app while the vault is open in the background.

{% include screenshot.html name="quick-capture" width=600 height=192 alt="ThingsMD’s Quick Capture popup with a task title, notes field, and scheduling controls" %}

Set **Default capture destination** in **Settings → ThingsMD** to choose where quick captures land.

- **Inbox (default)** collects new tasks in one place so you can review, schedule, or move them to a project later.
- **Daily note** adds each captured task to today’s note alongside your other entries. Enable Obsidian’s **Daily notes** core plugin first. ThingsMD hides the Inbox list and creates today’s note when needed.

### Capture on mobile

Enable **Use task actions in mobile navigation** to replace **New note** and **Search** with **New task** and **Search Tasks** in the bottom navigation bar.

### Repeating tasks
{: #repeating-tasks }

Choose **Repeat…** in the task menu or run **ThingsMD: Create or edit repeating rule**.

{% include screenshot.html name="repeat-options" width=440 height=634 alt="Repeat dialog with both modes, a weekly schedule, the next date, an end setting, and a deadline with two days of lead time" %}

- **Regularly** follows a fixed schedule even if earlier copies are unfinished.
- **After Completion** schedules the next copy when you finish or cancel the current one.
- **Add deadlines** sets a due date for each copy. With two days of lead time, a task due Friday becomes available on Wednesday.

Use the **ThingsMD: Show Repeating** command to edit or pause templates. From an occurrence, choose **Show repeating template**. Each copy has its own status and inherits the template’s description, unchecked checklist items, and project placements.

## Projects

Any Markdown note can be a project. Create a task in it or use **ThingsMD: Move task…** to file an existing task there. You can also drag and drop tasks between notes.

Tasks you create in a project note stay there and can appear in lists such as **Today** or **Upcoming**. In any task list, choose **Show in Project** from the context menu to jump to the containing note.

The **progress pie** is the small circle beside a project note in the File Explorer. Its filled portion shows the share of tasks that are finished, including completed and canceled tasks. Toggle **Settings → ThingsMD → Show project progress** to show or hide it.

{% include screenshot.html name="project-note" width=1150 height=740 alt="Studio Launch project note with tasks below its planning notes and progress indicators in the File Explorer" %}

## Search

Use **ThingsMD: Quick Find** to search list, project, and task titles. **Continue Search** also searches descriptions, checklists, and the Logbook.

## Logbook and Trash
{: #logbook-and-trash }

Check off a task to complete it or choose **Mark as Canceled** in the task menu. Both count as finished. The default **Daily** Logbook policy archives finished tasks at the next vault midnight. Adjust it in ThingsMD settings or run **ThingsMD: Log Completed**.

**First day of the week** in ThingsMD settings controls the date picker grid and where the Logbook starts a new week. **Automatic** uses the browser locale.

Deleting a selected card in Live Preview or Reading view supports Undo and Redo. Trash keeps tasks by default. A retention limit permanently removes expired files and embeds, and **Delete permanently** clears existing Trash and hides the list.

**Restore** in the Logbook reopens a task. **Restore** in Trash recovers the task’s previous status and, where possible, its original positions in notes.

## Calendars

Subscribe to a calendar feed to see events in **Today** and the next seven days of **Upcoming**.

1. Copy a subscription URL that serves ICS data without a sign-in. ThingsMD accepts `https://` and `webcal://` links and fetches them over HTTPS.
2. Open **Settings → ThingsMD → Calendars → Add calendar**, paste the URL, and save. Use the calendar’s gear menu for its name, color, refresh interval, or subscription URL.
3. Updates are automatic. To request an update manually, use the refresh button in Today or **ThingsMD: Refresh calendars**.

{% include screenshot.html name="calendar-add" width=584 height=200 light_width=560 light_height=180 alt="Add calendar dialog in ThingsMD settings with a masked Subscription URL field" %}

| Calendar provider | How to get the subscription link |
| --- | --- |
| **Google Calendar** | On the web, open **Settings → Settings for my calendars**, select the calendar, and copy **Integrate calendar → Secret address in iCal format**.<br>[Google Calendar Help](https://support.google.com/calendar/answer/37648) |
| **Apple Calendar,<br>iCloud** | On a Mac, enable **Public Calendar** for an iCloud calendar in Calendar. On iCloud.com, open its calendar information and click **Copy** under **Public Calendar**. On iPhone, use **Calendars → ⓘ → Public Calendar → Share Link**.<br>[Apple’s Mac guide](https://support.apple.com/guide/calendar/share-calendars-icl32362/mac) · [iCloud sharing guide](https://support.apple.com/guide/icloud/mm6b1a9479/icloud) · [Apple’s iPhone guide](https://support.apple.com/guide/iphone/iph7613c4fb/ios) |
| **Outlook.com,<br>Microsoft 365,<br>Exchange Online** | In Outlook on the web, open **Settings → Calendar → Shared calendars → Publish a calendar**. Select a calendar and detail level, click **Publish**, and copy the **ICS** link. Your organization may restrict publishing. [Microsoft Support](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-on-the-web) |
| **Fastmail** | In **Settings → Calendars**, edit the calendar and open **Publish**. Choose **Full event details** or **Free/busy information**, copy the URL, and save.<br>[Fastmail Help](https://www.fastmail.help/hc/en-us/articles/360060590793-Calendar-sharing-via-public-URL) |
| **Proton Calendar** | On an eligible paid plan, open **Settings → All settings → Calendars**, select the calendar, and choose **Share with anyone → Create link**. Copy a **Limited view** or **Full view** link. Updates can take up to eight hours.<br>[Proton Support](https://proton.me/support/share-calendar-via-link) |
| **Zoho Calendar** | In **Settings → Calendar → My Calendars**, select the calendar. Under **Sharing and permissions**, copy the **iCal** link from **Private URL** or **Public access**.<br>[Zoho Calendar Help](https://www.zoho.com/calendar/help/ways-to-share-calendars.html) |
| **Yandex Calendar** | Open the calendar’s settings and choose **Export → iCal**. Use the URL if it serves ICS without signing in.<br>[Yandex Calendar export guide](https://yandex.com/support/yandex-360/customers/calendar/web/en/sync/export) |
| **Nextcloud Calendar** | In the calendar’s share menu, click **+** beside **Share link**, open the public page, and copy its **subscription link**. Public feeds can omit private event details.<br>[Nextcloud Calendar manual](https://docs.nextcloud.com/server/stable/user_manual/en/groupware/calendar.html#publishing-a-calendar) · [Public calendar implementation](https://github.com/nextcloud/server/blob/v33.0.10/apps/dav/lib/CalDAV/PublicCalendar.php) |
| **ownCloud Classic** | In the Calendar app, open the calendar’s sharing panel and enable **Share link**. Copy the token from the end of the public link and paste `https://cloud.example.com/remote.php/dav/public-calendars/SHARE_TOKEN?export` into ThingsMD, replacing the host and token with your own. If ownCloud is installed in a subfolder such as `/owncloud`, include it before `/remote.php`. This requires public link sharing to be enabled.<br>[Calendar sharing guide](https://docs.owncloud.online/plugins/apps/calendar#offentliche-links) · [ownCloud Classic DAV source](https://github.com/owncloud/core/blob/v10.16.6/apps/dav/lib/Server.php) |
| **Radicale** | Enable sharing and token creation on the server. Create a read-only token share, then append its `PathOrToken` (including `/.token/`) to the server’s HTTPS URL.<br>[Radicale token sharing and examples](https://github.com/Kozea/Radicale/blob/v3.9.0/SHARING.md#sharing-access-via-tokens) |
| **Baïkal** | Stock Baïkal 0.13.0 has no anonymous ICS subscription for private calendars.<br>[Baïkal](https://github.com/sabre-io/Baikal) |
| **Synology Calendar** | Synology documents public web sharing, ICS file export, and CalDAV sync. A direct ICS subscription URL from **Public Share** is unverified. To subscribe in ThingsMD, provide a separate HTTPS ICS feed. [Synology Calendar guide](https://kb.synology.com/index.php/en-ca/DSM/help/Calendar/calendar_creating_calendars?version=7) |
{: .provider-table }

ThingsMD stores subscription URLs in Obsidian’s device-local Secret Storage. Enter the URL on each device that should refresh the calendar. On Linux, desktop encryption requires a supported system keyring. [Obsidian’s Secret Storage requirements](https://obsidian.md/changelog/2026-01-20-desktop-v1.11.5/)

{% include admonition.html type="warning" id="calendar-device-setup" title="Keep your iCal links private" body="Anyone with the link can access the past and future events it shares. Replace the link if it leaks." %}

### What sync shares and removal keeps
{: #calendar-cache-privacy }

ThingsMD saves the full calendar feed as `.ics` files in `ThingsMD/Calendars/` by default. Vault sync can copy those files to other devices. Depending on the feed, they may include attendees, descriptions, locations, and meeting links.

**Remove calendar** stops refreshes and removes the calendar from ThingsMD’s lists. Its saved URL and cached files remain until deleted separately.

### If events are missing or stale

Check the visibility toggle, the seven-day range, and what your provider publishes. Try **Refresh calendars** or **Change URL** if the link expired. A feed must work without a login, stay under 8 MB, and respond within 30 seconds.

## Hotkeys

ThingsMD leaves these commands unassigned. In **Settings → Hotkeys**, search for the command, click **+**, and press your chosen combination. If another command already uses it, pick a free combination or remove the old assignment with **×**.

| Command | Suggested Mac shortcut |
| --- | --- |
| **ThingsMD: Schedule task: Today** | **⌥⌘T** |
| **ThingsMD: Schedule task: This Evening** | **⌥⌘E** |
| **ThingsMD: Duplicate task** | **⌥⇧⌘D** |
| **ThingsMD: Move task…** | **⇧⌘M** |
| **ThingsMD: Set task deadline…** | **⇧⌘D** |

{% include screenshot.html name="hotkeys" width=900 height=300 alt="Obsidian Hotkeys settings showing assigned shortcuts for Duplicate task, Today, and This Evening" %}

[Obsidian’s hotkey guide](https://obsidian.md/help/hotkeys)

## The ThingsMD folder
{: #thingsmd-folder }

Task notes and calendar snapshots live in `ThingsMD/` by default. Uncheck **Hide ThingsMD folder** to show it in the File Explorer.

To move storage, set **ThingsMD home folder** to a vault-relative path such as `System/ThingsMD`. ThingsMD moves managed files and updates embeds. Include that folder in vault sync even when it’s hidden.

## Sync and conflicts
{: #sync }

Tasks and calendar snapshots sync through your vault’s existing sync service.

**Obsidian Sync** is the built-in option. Connect each device to the same remote vault, enable ThingsMD, and include the ThingsMD home folder and project notes in sync.

- To sync ThingsMD settings, enable **Installed community plugin list** under **Settings → Sync → Vault configuration sync**.
- To sync calendar snapshots (`.ics`), enable **Sync all other types** under **Selective sync**. [Obsidian Sync settings](https://obsidian.md/help/sync/settings)

If you already sync your vault with **Syncthing** or **Resilio Sync**, include your project notes and the ThingsMD home folder. Use the same vault-relative home folder path on every device.

### Sync conflicts

When files share a task ID, ThingsMD shows a conflict notice and uses one copy. It prefers `<id>.md`, then the shortest filename, with ties resolved by filename and path.

1. Expand **Review copies** and open **In use** and **Extra copy**.
2. Copy any changes you want to keep to the task in use.
3. Check that the embeds point to that task, then remove the extra file.

{% include screenshot.html name="conflict" width=1150 height=590 alt="Today lists both the task file in use and an extra copy in the expanded Review copies notice" %}

If another device changes a field you’re editing, ThingsMD stops the save. Copy your draft, reopen the task, and reapply your changes.

{% include admonition.html type="warning" id="sync-vault-time-zone" title="Keep the vault time zone consistent" body="Vault time zone syncs with the other ThingsMD settings when your sync tool includes the plugin configuration. If you keep plugin settings local, set the same zone on each device so automatic repeats and Logbook moves agree on dates." %}

## Integrations

Open a ThingsMD URL from a launcher or shortcut to prefill an editable task draft.

```text
obsidian://thingsmd?command=capture&title=Review%20proposal&description=Check%20the%20budget%20section
```

| Parameter | Value |
| --- | --- |
| `command` | Required. Use `capture`. |
| `title` | Optional title. Line breaks become spaces. |
| `description` | Optional Markdown description. Use `%0A` for line breaks. |
| `vault` | Optional vault name or ID, such as `My%20Vault`. ThingsMD must be enabled there. |

URL-encode each value. Captures use your default destination. If a draft is already open, finish or cancel it before sending the link again. [Obsidian’s URI guide](https://obsidian.md/help/uri)

## Import and export

Use conversion to bring existing inline tasks into ThingsMD without retyping them. ThingsMD accepts plain checkboxes, [Tasks Emoji format](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Reference/Task%20Formats/Tasks%20Emoji%20Format.md) ([Tasks plugin](https://github.com/obsidian-tasks-group/obsidian-tasks)), and [Dataview format](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-tasks/) ([Dataview plugin](https://community.obsidian.md/plugins/dataview)).

- **Convert selected tasks only.**  
  Select the task lines in Live Preview or Reading view. Right-click the selection and choose **Convert to ThingsMD format**, or run **ThingsMD: Convert selected tasks…** from the command palette.
- **Convert all tasks in the current note.**  
  Use **Convert all tasks to ThingsMD format** from the note menu or command palette. Use **Convert all tasks to Tasks Emoji / Dataview format** to go back.
- **Convert the entire vault.**  
  In **Settings → ThingsMD → Conversion**, choose **Convert vault to ThingsMD format** or **Convert vault to Tasks Emoji / Dataview format**. The confirmation shows how many tasks and notes will change.

{% include screenshot.html name="convert-selected-tasks" width=800 height=540 alt="Obsidian’s Live Preview context menu with Convert to ThingsMD format highlighted below the standard editing actions" %}

### What conversion supports

| Source data | Supported in ThingsMD? | Result |
| --- | --- | --- |
| Title and checkbox status | Yes | Imports the title and maps the checkbox to open, completed, or canceled. Custom checkbox states become open. |
| Scheduled, start, and due dates | Yes | The scheduled date takes precedence over the start date. The due date becomes the deadline. |
| Creation, completion, and cancellation dates | Yes | Imports recognized dates into the task’s history. |
| Repeating rules | No | Preserved for conversion back to Markdown. Set up a ThingsMD repeating rule to generate new occurrences. |
| Priorities, dependencies, source IDs, and on-completion actions | No | Recognized metadata is preserved for conversion back. ThingsMD uses its own task ID. |
| Indented notes and subtasks | No | Prose stays in the source note. Eligible nested checkboxes become separate tasks. |

Conversion skips fenced code, YAML, and invalid or ambiguous task lines.

### Return to inline checkboxes

Even if you imported only a few tasks, use **Settings → ThingsMD → Conversion → Convert vault to Tasks Emoji / Dataview format** to find and convert all eligible imported tasks across the vault. Existing inline checkboxes and tasks created directly in ThingsMD stay as they are.

For a single imported task, choose **Convert to Tasks Emoji / Dataview format** in its task menu. ThingsMD restores the original syntax and writes back supported changes such as edited dates. If the task appears in several notes, each card becomes an independent checkbox.

## Task properties

A project note embeds a task on its own line using a link such as `![[ThingsMD/8f4bb3cd-8199-4a79-b47f-a17c51428fe8]]`. The task file’s Markdown body is its description. Use task controls to edit the protected YAML fields shown here.

```yaml
---
type: thingsmd-task
id: 8f4bb3cd-8199-4a79-b47f-a17c51428fe8
title: Review launch checklist
status: todo
when: '2026-11-24'
deadline: '2026-11-27'
is_waiting: false
checklist:
  - text: Check release assets
    done: true
  - text: Review installation steps
    done: false
created: '2026-11-20T09:00:00.000Z'
---
```

| Property | Value and meaning |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type` | `thingsmd-task` identifies the file as a ThingsMD task. |
| `id` | Stable task identifier. ThingsMD generates it and uses it to identify the task across edits and devices. |
| `title` | Task title as text. |
| `status` | `todo` for open, `done` for completed, or `canceled` for canceled. |
| `when` | A start date in `YYYY-MM-DD`, `today`, `anytime`, or `someday`. An omitted or `null` value leaves the task unscheduled. **Tomorrow** is saved as a date. |
| `deadline` | A due date in `YYYY-MM-DD`. Omit it or use `null` when there is no deadline. |
| `evening` | For **This Evening**, ThingsMD stores `when: today` and the evening’s date in this field. |
| `is_waiting` | Boolean waiting flag. Turning off the Waiting For setting keeps the flag and returns tasks to their normal lists. |
| `checklist` | Ordered list of items, each with a text label in `text` and a boolean completion flag in `done`. |
| `project` | Optional placement metadata, usually a vault-relative Markdown path. Standalone embeds determine which notes contain the task. |
{: .task-properties-table }

| Managed property | Meaning |
| --- | --- |
| `created`, `completed`, `loggedAt` | Creation, completion or cancellation, and Logbook timestamps. Imported dates can be date-only. |
| `order`, `listOrder` | Numeric sort rank and optional overrides by list or date group, such as `upcoming:2026-11-24`. |
| `deadlineDeferredOn` | Date a due task was deliberately moved out of Today. |
| `deleted`, `deletedAt`, `deletedFrom` | Trash flag, deletion timestamp, and original note placement. |
| `repeat` | Cadence (`mode`, `unit`, `interval`, `on`), dates (`anchor`, `next`, `end`), deadlines (`deadline`, `leadDays`), and state (`epoch`, `lastCopy`, `waitingFor`, `paused`). The nested `deadline` is a boolean. |
| `repeatSource`, `repeatDate`, `repeatEpoch` | Template ID, occurrence date, and series identity for a generated copy. |
| `conversion` | Original line, syntax, and values for Markdown round-tripping. |
{: .task-properties-table }

Repeat modes are `regular` and `completion`. Units are `day`, `week`, `month`, and `year`, with intervals from 1 to 999. In `on` patterns, weekdays run from 0 (Sunday) to 6 and months from 1 to 12. Use `day: -1` or `ordinal: -1` for the last day or matching weekday of the month.

## Credits

I have a lot of respect for the team at Cultured Code. They built [Things](https://culturedcode.com/things/), a beautifully designed app that makes managing personal tasks feel easy. I borrowed their ideas to make my own life easier by bringing my favorite way to manage tasks into Obsidian, my favorite note-taking app.

ThingsMD is an independently developed plugin, unaffiliated with Cultured Code.

If you’d like to support my work on ThingsMD, please star this repository.

</div>
