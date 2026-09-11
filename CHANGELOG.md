# Changelog

## [Unreleased]

### Added

- **Finish keys.** A per-action list of key combos that are pressed once the typing has finished. Leave it empty for none. Saves building a Multi Action with a hand-calculated wait just to send a message with Return. ([#2](https://github.com/ewels/type-deck/issues/2))
  - Add as many steps as you like. They run in order, each with its own _Record_ button, so a sequence like Tab, Tab, Return is a few clicks.
  - Record a combo by pressing the keys, or type it in by hand for the few shortcuts the OS swallows before the settings panel sees them.
  - A key name that Stream Deck cannot press is outlined in red as you type it, rather than being silently skipped at press time.
  - A delay (100 ms by default) is applied before each step, so a step can wait for something like a dialog to open first.

### Fixed

- Characters outside ASCII (`♯`, `é`, emoji) are now inserted with a quick clipboard paste on Windows and Linux, where the underlying keyboard library typed them as the wrong character or not at all. Your clipboard contents are put back afterwards. ([#1](https://github.com/ewels/type-deck/issues/1))

## [0.2.1] - 2026-05-22

### Changed

- Rebuilt the marketplace and category icons so they no longer reuse Stream Deck's own branding (the device hex-grid and Elgato logo). They now use the same quotes glyph as the **Type text** action.

## [0.2.0] - 2026-05-19

### Added

- **Instant type.** An opt-in toggle on every action that pastes the whole text via the system clipboard in one go (Cmd+V on macOS, Ctrl+V on Windows), instead of typing it out character by character.
  - The checkbox auto-ticks once the text grows past 500 characters. Untick it and it stays unticked.
  - Your previous clipboard contents are restored after the paste.
  - Timing, Natural typing and the safety cancel toggle are greyed out while it is on.
  - Falls back to typing on Linux (where `pbcopy` / `Set-Clipboard` aren't available) or if the clipboard write fails.

### Changed

- Removed the 300 ms pre-typing focus delay. Stream Deck is a hardware button, so the target app is already focused when you press the key.

## [0.1.0] - 2026-05-18

First public release.

### Added

- Three actions: **Type text** (types the configured text every press, with an optional long press for a second string), **Cycle next** (one entry per line, typing the next line each press) and **Random pick** (same line-per-entry format, picked at random).
- Per-character, per-word and per-paragraph delays.
- Jitter, randomizing each delay by a configurable percent (on by default at 100 %).
- Adjacent-key typo simulation: an occasional wrong key, a brief pause, backspace, then the correct character.
- Template variables expanded at type-time: `{date}`, `{time}`, `{clipboard}` and `{counter}`. Escape literal braces with `{{` and `}}`.
- Cancel or queue a press while typing is already running.

[unreleased]: https://github.com/ewels/type-deck/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/ewels/type-deck/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ewels/type-deck/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ewels/type-deck/releases/tag/v0.1.0
