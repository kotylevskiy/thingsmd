<h1 align="center">ThingsMD for Obsidian</h1>

<p align="center"><strong>A Things 3 alternative with familiar lists, task cards and behavior.<br>
Keep your notes and tasks together.</strong></p>

<p align="center">
  <a href="https://kotylevskiy.github.io/thingsmd/#install"><img src="https://img.shields.io/badge/Obsidian-1.11.5%2B-7c3aed?logo=obsidian" alt="Requires Obsidian 1.11.5 or later"></a>
  <a href="https://github.com/kotylevskiy/thingsmd/releases/latest"><img src="https://img.shields.io/badge/Latest_release-0.8.4-086ddd?logo=github" alt="Latest release 0.8.4"></a>
</p>

![ThingsMD Today view beside Obsidian’s File Explorer, showing folders, regular notes, and project notes with task progress indicators](docs/assets/today.png)

<p align="center"><a href="https://kotylevskiy.github.io/thingsmd/"><img src="docs/assets/documentation-link.png" alt="ThingsMD Documentation →" width="272" height="44"></a></p>

## Features

Turn any note into a project, capture tasks as they come up, and plan your day in Today and Upcoming. Every task is a Markdown file in your vault.

- Keep tasks beside project notes.
- Start dates, deadlines, recurring tasks and checklists.
- Capture tasks from the command palette, with a global desktop shortcut.
- See calendar events alongside tasks in Today and Upcoming.
- Convert existing Markdown checkboxes, including Tasks Emoji and Dataview formats, into ThingsMD tasks.

## System access and network use

- **Network use.** ThingsMD works offline for task management. If you add a calendar subscription, it connects to the calendar provider or self-hosted server you configure to download and refresh the iCal feed. Obsidian’s device-local Secret Storage holds the subscription URL, and ThingsMD caches downloaded calendar data in your vault.
- **Vault access.** ThingsMD reads and writes Markdown files in the active vault. It scans notes to find task embeds and project associations and to convert checkboxes when you run vault-wide conversion.
- **Clipboard access.** Cutting or copying a task writes its Markdown embed to the clipboard. ThingsMD checks the text supplied by a paste event to handle task transfers. Option/Alt+Paste reads the clipboard to verify that it still contains the copied task before moving it. Clipboard text stays on the device.
- **Electron IPC.** The optional desktop global capture shortcut uses inter-process communication (IPC). When you press the shortcut, Electron focuses Obsidian and sends a signal to open Quick Capture. The signal carries no task data.

## Feedback and contributions

Ideas, bug reports, and feature requests are welcome in [GitHub Issues](https://github.com/kotylevskiy/thingsmd/issues). I maintain the code myself and don’t accept code contributions.

For bug reports, include your ThingsMD and Obsidian versions, your operating system, and the steps to reproduce the issue.

## Thanks to Cultured Code

ThingsMD is inspired by [Things](https://culturedcode.com/things/), Cultured Code’s personal task manager for Apple devices and one of my favorite ways to put GTD into practice. I brought ideas from their beautifully designed app into Obsidian, where I already keep my notes.

ThingsMD is an independently developed plugin, unaffiliated with Cultured Code.

If you’d like to support my work on ThingsMD, please star this repository.
