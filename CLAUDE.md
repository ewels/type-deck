# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Stream Deck plugin ("Type Deck") that simulates a human typing preset text into the focused application when a Stream Deck key is pressed. Plugin UUID: `com.ewels.type-deck`. Three actions:

- `com.ewels.type-deck.type` ("Type text") — types `settings.text` verbatim. Supports long-press for an alternative text.
- `com.ewels.type-deck.cycle` ("Cycle next") — text is one entry per line; each press types the next line, looping. Persists `cycleIndex` in settings.
- `com.ewels.type-deck.random` ("Random pick") — text is one entry per line; each press types a random line.

Every action also supports `instantType` (paste-via-clipboard); see [Instant type](#instant-type) below.

## Commands

```sh
npm run build         # one-off rollup build → com.ewels.type-deck.sdPlugin/bin/plugin.js
npm run watch         # rebuild on save, then restart the plugin in Stream Deck via @elgato/cli
npm run lint          # biome lint
npm run lint:fix      # biome lint --write
npm run check         # biome check (lint + format)
npm run format        # prettier --write + biome format --write
npm run format:check  # prettier --check + biome format (no write)
```

A code change does not appear in Stream Deck until the plugin process is restarted (`npm run watch` handles this automatically, or run `streamdeck restart com.ewels.type-deck`). Property-inspector HTML edits are picked up by reopening the action's settings panel.

## Git hooks: prek, not pre-commit

Hooks live in `prek.toml` (TOML) and are run by [prek](https://github.com/j178/prek), a Rust-based replacement for `pre-commit`. **Do not invoke `pre-commit` or write `.pre-commit-config.yaml`.** TOML config requires `prek >= 0.4.0` (`brew upgrade prek`).

```sh
prek install              # install git hook
prek run --all-files      # run hooks across the repo
prek auto-update          # bump pinned hook revs
```

Hooks: standard pre-commit-hooks (whitespace/EOL/yaml/json/merge-conflict), Prettier (JSON/YAML/MD/HTML/CSS), Biome (lint + format for JS/TS).

## Release process

The version lives in `com.ewels.type-deck.sdPlugin/manifest.json` as a four-part `X.Y.Z.0` string (Elgato's format — the trailing `.0` stays zero). `package.json` is `private: true` with no `version` field, so the manifest is the only place to bump.

To cut a release:

```sh
# 1. Move the CHANGELOG.md "Unreleased" entries under a new "## [X.Y.Z] - YYYY-MM-DD"
#    heading, add the compare link at the bottom, and bump manifest "Version" to
#    "X.Y.Z.0" on a clean tree, then push.
git commit -m "Bump version to X.Y.Z" CHANGELOG.md com.ewels.type-deck.sdPlugin/manifest.json
git push origin main
# 2. Create the release. gh creates the tag on the remote at HEAD; no local tag needed.
gh release create vX.Y.Z --title "vX.Y.Z — <headline>" --notes "..."
```

**Do not `streamdeck pack` locally and attach the asset by hand.** `.github/workflows/release.yml` fires on `release: published`, runs `npm ci && npm run build`, stages a tiny `package.json` inside `com.ewels.type-deck.sdPlugin/` so `@nut-tree-fork/libnut` is installed alongside `bin/plugin.js` (all three `libnut-{darwin,win32,linux}` `.node` files), packs the plugin, and uploads `com.ewels.type-deck.streamDeckPlugin` to the release with `--clobber`. A locally-packed asset would only carry the host platform's libnut binary.

`CHANGELOG.md` is the running record of user-visible changes (Keep a Changelog format, newest first). Add to its `## [Unreleased]` section as changes land, not at release time. The GitHub release notes are written separately and are chattier; the changelog entries are the terse version. The no-em-dashes convention applies to it.

Release-notes style mirrors past releases: title is `vX.Y.Z — <headline>`, body has `## Highlights` and `## Install` sections. Check `gh release view vX.Y.Z` on a previous release for the exact template.

## Architecture

```
src/
  plugin.ts             bootstrap: registers all three actions + connect()
  actions/base.ts       BaseTypeAction — shared state, lifecycle, typing loop
  actions/type.ts       TypeAction (long-press)
  actions/cycle.ts      CycleAction (lines, advancing index)
  actions/random.ts     RandomPickAction (lines, random pick)
com.ewels.type-deck.sdPlugin/
  manifest.json         plugin manifest (validated by Elgato JSON schema)
  ui/type.html          property inspector (sdpi-components v4 over CDN)
  ui/cycle.html         PI for Cycle
  ui/random.html        PI for Random pick
  bin/plugin.js         rollup output, gitignored
  imgs/, logs/          icons and runtime logs (logs gitignored)
rollup.config.mjs       bundles src/ to bin/plugin.js
                        `@nut-tree-fork/*` packages are marked external —
                        loaded from node_modules at runtime, not bundled
```

The Stream Deck app spawns `node bin/plugin.js`, which connects to Stream Deck over a websocket. `@elgato/streamdeck` translates websocket events into per-action handlers via `SingletonAction`.

`BaseTypeAction<S>` is an abstract `SingletonAction<S extends BaseTypingSettings>` that owns lifecycle methods (`onWillAppear`, `onDidReceiveSettings`, `onKeyDown`, `onKeyUp`), the typing loop, and per-instance state (`isTyping`, `abortRequested`, `queuedRun`, long-press timer). Subclasses override two hooks:

- `pickText(settings)` — returns `{ text, update? }` (the `update` is merged into settings before typing starts, e.g. an advanced `cycleIndex`).
- `pickLongPressText(settings)` — return `null` for no long-press; return a string to opt this action in.

Per-action persisted state (counter, cycleIndex) is stored in the action's settings via `ev.action.setSettings(...)`. There is no global plugin state.

### Key press lifecycle

`BaseTypeAction.onKeyDown` decides one of three paths:

1. **Already typing** — set `abortRequested` (cancel) or `queuedRun` (queue another run) and return.
2. **`pickLongPressText` returned a string** — start a timer for `longPressThresholdMs`. If `onKeyUp` fires first → short-press text. If timer fires first → long-press text.
3. **Otherwise** — type immediately from `onKeyDown` using `pickText`.

`pickText`'s `update` is persisted **before typing starts**, so an aborted run still advances the cycle. Variables (`{date}`, `{time}`, `{clipboard}`, `{counter}`) are always expanded; `{counter}` only writes to settings when actually referenced in the text.

### Instant type

If `settings.instantType` is set, the per-character typing loop is bypassed. The flow:

1. Snapshot the current clipboard via `readClipboard()` (kicked off in parallel with `expandVariables` to save a subprocess round-trip).
2. `writeClipboard(text)`.
3. `libnut.keyTap("v", [modifier])` where modifier is `"meta"` on macOS, `"control"` elsewhere.
4. Sleep 150 ms so the target app consumes the paste.
5. Restore the original clipboard.

If `writeClipboard` is unavailable (Linux has no `pbcopy` / `Set-Clipboard`) or fails, the path falls back to a line-by-line `libnut.typeString` + `keyTap("enter")` loop (still bypassing per-character timing / jitter / typos — those only apply to the regular typing path).

Timing/jitter/typo settings are all ignored when `instantType` is on; the PI HTML greys them out.

### Native keyboard / clipboard

The plugin calls into [`@nut-tree-fork/libnut`](https://www.npmjs.com/package/@nut-tree-fork/libnut) directly (the raw native binding under nut-js) via its internal subpath `dist/import_libnut.js` — a type shim lives at `src/types/libnut.d.ts`. We use exactly three libnut functions: `typeString`, `keyTap`, `setKeyboardDelay`. Clipboard reads use a small `pbpaste` / PowerShell `Get-Clipboard` subprocess in `readClipboard()`; no clipboard dependency.

`libnut.typeString` decodes UTF-8 into code points correctly, but on Windows and Linux it then truncates each code point to a single byte before mapping it to a physical key (`toggleUniKey((char)n, ...)` in libnut-core's `src/win32/keypress.c` / `src/linux/keypress.c`). Anything above U+007F is therefore typed as the wrong character or not at all, which is [issue #1](https://github.com/ewels/type-deck/issues/1). macOS passes the full code point to `CGEventKeyboardSetUnicodeString` and types any character verbatim.

So the regular typing loop checks each character with `isNativelyTypeable()` and routes the ones libnut can't handle through `pasteText()` (clipboard write plus Cmd/Ctrl+V, the same helper the Instant type path uses). Consecutive untypeable characters are batched into a single paste, so a wholly non-Latin string is one paste rather than one per character. The original clipboard is read once, lazily, on the first paste of a run and restored in a `finally` when the run ends (an aborted run included). Where no clipboard is available (Linux) the loop falls back to `typeString` and logs a warning.

The libnut package transitively installs `libnut-darwin`, `libnut-win32` and `libnut-linux` as regular deps — every install gets all three platform `.node` files, so packaging is platform-agnostic.

### One critical native-blocking workaround

At the top of `src/actions/base.ts` you'll see `libnut.setKeyboardDelay(0)`. Don't remove it. libnut's default internal `keyboardDelay` is **300 ms** and that sleep happens _inside_ the synchronous native `typeString` call. It blocks the JS thread per keystroke — long enough that websocket messages (including a second keyDown press) cannot be dispatched until typing finishes, breaking abort/queue.

Related: the local `sleep()` helper uses `setTimeout` for _every_ value including 0 ms. A `Promise.resolve()` for 0 ms only flushes the microtask queue and does not yield to macrotasks (where websocket messages dispatch), so a 100%-jitter roll of 0 ms would otherwise also block event delivery.

Related: the Instant type path temporarily restores `setKeyboardDelay(40)` just around the `keyTap("v", [modifier])` call, then sets it back to 0. macOS won't register Cmd+V if there's zero gap between the modifier press and the key tap — the 40 ms gap is what makes the paste actually fire.

### Property inspector quirks

- Plain HTML elements (`<small>`, `<div>`, plain text) inherit the Stream Deck PI webview's default font, which on macOS WebKit is **Times serif**. The `<style>` block sets `body { font-family: <system stack> }` to fix this. sdpi-components style their own shadow DOMs and are unaffected.
- `sdpi-checkbox` value is a real boolean; `default="true"` is the initial display value when the setting is undefined — it doesn't necessarily auto-persist until the user touches the form.

### Settings schema

`BaseTypingSettings` in `src/actions/base.ts` is the source of truth for the shared runtime contract; each subclass extends it with action-specific fields (e.g. `longPress*` in `type.ts`, `cycleIndex` in `cycle.ts`). Number fields are stored as strings by sdpi-textfield, so the runtime always re-parses through `toNumber(value, fallback)`. The `DEFAULTS` object holds the fallback used when a field is missing or unparseable — keep this in sync with the `placeholder=` / `default=` attributes in `ui/type.html`.

### Manifest

`com.ewels.type-deck.sdPlugin/manifest.json` declares `Software.MinimumVersion: "7.1"` and `SDKVersion: 3`. The manifest's `$schema` URL points at Elgato's JSON schema; VS Code also has a schema mapping in `.vscode/settings.json`. The 7.1 branch of the schema marks `Software`, `Actions`, `Author`, `CodePath`, `Description`, `Icon`, `Name`, `OS`, `SDKVersion`, `UUID`, `Version` as required.

## Conventions

**No em-dashes in user-facing text.** README copy, UI HTML labels and tooltips, anything visible to a Stream Deck user (including source comments captured in screenshots): use a period, colon, or parentheses instead of `—`. Em-dashes read as AI-generated. See commit `eba48ca` ("Death to the emdashes") for the precedent — it touched `README.md`, the action PI HTML files, and a comment in `src/actions/base.ts`. This rule does **not** apply to internal docs like CLAUDE.md or this file.
