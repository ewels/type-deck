# Marketplace description

## Short description

Type Deck types preset text into the focused app when you press a key. Optional human-feel timing, randomised delays and occasional adjacent-key typos make the output look hand-typed. Four actions: a single string, a cycling list, a random pick, or a Stream Deck + dial you rotate to choose.

## Full description

Type Deck types preset text into the focused app when you press a key. Optional human-feel timing, randomised delays and occasional adjacent-key typos make the output look hand-typed. Four actions: a single string, a cycling list, a random pick, or a Stream Deck + dial you rotate to choose.

**Actions**

- **Type text** — types the configured text on every press. Optional long-press for a second, alternative string.
- **Cycle next** — each non-empty line of the text field is one entry; each press types the next line, looping back to the start.
- **Random pick** — same line-per-entry format as Cycle next, but each press picks one at random.
- **Dial pick** (Stream Deck + only): rotate the dial to move through the list, press it to type the entry shown on the touchscreen, which displays the position and a preview of the text.

**Human-feel typing**

- Per-character, per-word and per-paragraph delays for natural pacing.
- Jitter randomises each delay by a configurable percent so the rhythm isn't robotic. On by default.
- Adjacent-key typo simulation: a wrong key, a brief pause, a backspace, then the correct key.

**Template variables**

Inline tokens are expanded at type-time:

- `{date}` — current date (YYYY-MM-DD)
- `{time}` — current time (HH:MM:SS)
- `{clipboard}` — current clipboard contents
- `{counter}` — press count, persisted per action

Use `{{` and `}}` for literal braces.

**Safety**

Press the key while it's already typing and your choice: abort the current run, or queue another run to start immediately after. Configurable per action.

Useful for boilerplate snippets, demo scripts, prepared answers, and replaying short sequences while screen-sharing.
