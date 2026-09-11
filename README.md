<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Type Deck" width="480">
  </picture>
</p>

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that types preset text into the focused application when you press a key, with optional human-like timing, typos, and jitter so the output doesn't look obviously automated.

Useful for things like inserting boilerplate snippets, demo scripts, prepared answers, or replaying short typed sequences while screen-sharing.

## Actions

| Action          | What it does                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| **Type text**   | Types the configured text every press. (Optional: **long press** types a second, different string)             |
| **Cycle next**  | Each non-empty line of the text field is one entry. Each press types the next line, looping back to the start. |
| **Random pick** | Same line-per-entry format as Cycle next, but each press picks one at random.                                  |

## Features

- **Per-character, per-word and per-paragraph delays.** Tune typing speed to suit the receiving app or demo situation.
- **Jitter.** Randomize each delay by ±N % so the rhythm doesn't feel too robotic. Enabled by default at 100 %.
- **Adjacent-key typos.** Per-character chance of typing a wrong key, pausing, hitting backspace, and continuing. What could be more Human than errors?
- **Template variables.** Inline tokens are expanded at type-time:
  - `{date}` → `YYYY-MM-DD`
  - `{time}` → `HH:MM:SS`
  - `{clipboard}` → current clipboard contents
  - `{counter}` → number of presses (persisted per action)
  - Use `{{` and `}}` for literal braces.
- **Unicode symbols.** Characters outside ASCII (`♯`, `é`, emoji) can't be sent as plain keystrokes on Windows, so they are inserted with a quick clipboard paste instead. Your clipboard contents are put back afterwards.
- **Cancel or queue.** Pressing the key while it's already typing either aborts the current run (default) or queues another run to start immediately after, depending on the per-action setting.
- **Finish keys.** Optionally press one or more key combos once the typing is done (eg. <kbd>enter</kbd> or <kbd>cmd</kbd>+<kbd>a</kbd>). Add a step, click _Record_ and press the keys you want, or type the combo in by hand. Steps run in order with a configurable delay before each.

<p align="center">
  <img src="docs/screenshot.png" alt="Type Deck plugin in the Stream Deck app, showing the three actions and the Type text settings panel">
</p>

## Installation

Download the latest `com.ewels.type-deck.streamDeckPlugin` from the [Releases](https://github.com/ewels/type-deck/releases) page and double-click it. Stream Deck will install the plugin.

See [`CHANGELOG.md`](./CHANGELOG.md) for what changed in each version.

<!-- prettier-ignore-start -->
> [!NOTE]
> **macOS:** The plugin types via OS-level keyboard simulation, which may require granting Stream Deck **Accessibility** permission under _System Settings → Privacy & Security → Accessibility_.
<!-- prettier-ignore-end -->

## Development

Requires Node 24 and [@elgato/cli](https://github.com/elgatosf/cli) for the dev/install loop.

```sh
npm install
npm run watch   # rebuild on save + auto-restart the plugin
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture notes.

## License and Credits

Released with the [MIT license](./LICENSE).

By Phil Ewels ([@ewels](https://github.com/ewels)).
