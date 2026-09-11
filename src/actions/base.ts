import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import streamDeck, {
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  SingletonAction,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { libnut } from "@nut-tree-fork/libnut/dist/import_libnut.js";

const execFileP = promisify(execFile);

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";

// libnut's default native keyboardDelay is 300 ms and is honored *inside* the
// synchronous native typeString call. That blocks the JS thread per keystroke
// and starves the websocket loop, preventing a second keyDown press from being
// received mid-typing. Set to 0 here; all timing is managed in user-space.
libnut.setKeyboardDelay(0);

async function readClipboard(): Promise<string> {
  try {
    if (IS_MAC) {
      const { stdout } = await execFileP("pbpaste", []);
      return stdout;
    }
    if (IS_WIN) {
      // windowsHide prevents a console flash every time {clipboard} expands.
      const { stdout } = await execFileP(
        "powershell.exe",
        ["-NoProfile", "-Command", "Get-Clipboard"],
        { windowsHide: true },
      );
      return stdout.replace(/\r?\n$/, "");
    }
    return "";
  } catch {
    return "";
  }
}

function writeClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[] = [];
    let opts: { windowsHide?: boolean } = {};
    if (IS_MAC) {
      cmd = "pbcopy";
    } else if (IS_WIN) {
      cmd = "powershell.exe";
      // [Console]::In.ReadToEnd() reads stdin as one blob, preserving newlines.
      args = [
        "-NoProfile",
        "-Command",
        "[Console]::In.ReadToEnd() | Set-Clipboard",
      ];
      opts = { windowsHide: true };
    } else {
      resolve(false);
      return;
    }
    try {
      const child = spawn(cmd, args, opts);
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.on("error", () => resolve(false));
      child.stdin.end(text, "utf-8");
    } catch {
      resolve(false);
    }
  });
}

export type BaseTypingSettings = {
  text?: string;
  instantType?: boolean;
  charDelay?: number | string;
  wordDelay?: number | string;
  paragraphDelay?: number | string;

  jitterEnabled?: boolean;
  jitterPercent?: number | string;
  typosEnabled?: boolean;
  typoChance?: number | string;

  counter?: number;
  cancelOnSecondPress?: boolean;

  finishKeyEnabled?: boolean;
  finishKeyCombo?: string;
  finishKeyDelayMs?: number | string;
};

export const DEFAULTS = {
  charDelay: 5,
  wordDelay: 40,
  paragraphDelay: 400,
  jitterPercent: 100,
  typoChance: 3,
  typoCorrectionMs: 400,
  longPressThresholdMs: 500,
  finishKeyDelayMs: 100,
} as const;

const PREVIEW_MAX_LEN = 20;

// Always go via setTimeout: `Promise.resolve()` only flushes microtasks, which
// doesn't let the websocket message queue (a macrotask) process a second
// keyDown event mid-typing.
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function toNumber(value: unknown, fallback: number): number {
  const n =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function previewTitle(text: string | undefined): string {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "Type";
  return collapsed.length > PREVIEW_MAX_LEN
    ? `${collapsed.slice(0, PREVIEW_MAX_LEN)}…`
    : collapsed;
}

// QWERTY physical-key adjacency. Lower-case lookup; case is restored by the
// caller.
const QWERTY_ADJACENT: Record<string, string> = {
  q: "wa",
  w: "qeasd",
  e: "wrsdf",
  r: "etdfg",
  t: "ryfgh",
  y: "tughj",
  u: "yihjk",
  i: "uojkl",
  o: "ipkl",
  p: "ol",
  a: "qwsz",
  s: "awedzx",
  d: "serfxc",
  f: "drtgcv",
  g: "ftyhvb",
  h: "gyujbn",
  j: "huiknm",
  k: "jiolm",
  l: "kop",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

function adjacentKey(char: string): string | null {
  const lower = char.toLowerCase();
  const neighbours = QWERTY_ADJACENT[lower];
  if (!neighbours) return null;
  const pick = neighbours[Math.floor(Math.random() * neighbours.length)];
  return char === lower ? pick : pick.toUpperCase();
}

function applyJitter(ms: number, pct: number): number {
  if (ms <= 0 || pct <= 0) return ms;
  const factor = 1 + ((Math.random() * 2 - 1) * pct) / 100;
  return Math.max(0, Math.round(ms * factor));
}

export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const VAR_PATTERN = /\{\{|\}\}|\{(date|time|counter|clipboard)\}/g;

async function expandVariables(text: string, counter: number): Promise<string> {
  if (!text.includes("{")) return text;
  const clip = text.includes("{clipboard}") ? await readClipboard() : "";
  return text.replace(VAR_PATTERN, (match, name) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    switch (name) {
      case "date":
        return new Date().toISOString().slice(0, 10);
      case "time": {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }
      case "counter":
        return String(counter);
      case "clipboard":
        return clip;
      default:
        return match;
    }
  });
}

// Modifier names accepted in a stored combo, normalized to the names libnut
// expects. "meta" is Command on macOS and the Windows key elsewhere.
const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: "control",
  control: "control",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
  win: "meta",
};

// Canonical serialization order, matching what the property inspector records.
const MODIFIER_ORDER = ["control", "alt", "shift", "meta"];

export type KeyCombo = { key: string; modifiers: string[] };

/**
 * Parse a stored combo string such as "meta+shift+enter" into the key name and
 * modifier list that libnut.keyTap wants. Returns null if there is no key.
 */
export function parseKeyCombo(raw: unknown): KeyCombo | null {
  const parts = String(raw ?? "")
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  const modifiers: string[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    } else {
      // Last non-modifier token wins, so "ctrl+a" and "a+ctrl" both work.
      key = part;
    }
  }
  if (key === null) return null;
  modifiers.sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b),
  );
  return { key, modifiers };
}

/**
 * Result of picking the text to type for a single press.
 * `update` is merged into settings and persisted before typing starts, so an
 * aborted run still advances cycle index / counter.
 */
export type PickResult<S> = {
  text: string;
  update?: Partial<S>;
} | null;

export abstract class BaseTypeAction<
  S extends BaseTypingSettings,
> extends SingletonAction<S> {
  private isTyping = false;
  private abortRequested = false;
  private queuedRun = false;

  /** Subclass-specific text selection. Long-press handling is opt-in. */
  protected abstract pickText(settings: S): PickResult<S>;

  /** Override in TypeAction to return the long-press text. */
  protected pickLongPressText(_settings: S): string | null {
    return null;
  }

  protected longPressThreshold(_settings: S): number {
    return DEFAULTS.longPressThresholdMs;
  }

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressFired = false;

  override onWillAppear(ev: WillAppearEvent<S>): Promise<void> {
    return ev.action.setTitle(previewTitle(ev.payload.settings.text));
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<S>): Promise<void> {
    return ev.action.setTitle(previewTitle(ev.payload.settings.text));
  }

  override async onKeyDown(ev: KeyDownEvent<S>): Promise<void> {
    const { settings } = ev.payload;

    if (this.isTyping) {
      if (settings.cancelOnSecondPress) {
        this.abortRequested = true;
      } else {
        this.queuedRun = true;
      }
      return;
    }

    const longText = this.pickLongPressText(settings);
    if (longText !== null) {
      const threshold = this.longPressThreshold(settings);
      this.longPressFired = false;
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.longPressFired = true;
        void this.runTyping(ev.action, settings, longText);
      }, threshold);
      return;
    }

    await this.runTyping(ev.action, settings, null);
  }

  override async onKeyUp(ev: KeyUpEvent<S>): Promise<void> {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.longPressFired) {
      this.longPressFired = false;
      return;
    }
    if (this.pickLongPressText(ev.payload.settings) !== null) {
      await this.runTyping(ev.action, ev.payload.settings, null);
    }
  }

  /**
   * Tap the configured combo once the run has finished typing. Skipped when the
   * run was aborted, or when the user aborts during the post-typing delay.
   */
  private async pressFinishKey(settings: S): Promise<void> {
    if (!settings.finishKeyEnabled) return;
    const combo = parseKeyCombo(settings.finishKeyCombo);
    if (!combo) return;

    const delayMs = toNumber(
      settings.finishKeyDelayMs,
      DEFAULTS.finishKeyDelayMs,
    );
    if (delayMs > 0) await sleep(delayMs);
    if (this.abortRequested) return;

    // Same reason as the instant-type paste: keyboardDelay is 0, so there is no
    // gap between the modifier press and the key tap and macOS drops the combo.
    const needsGap = combo.modifiers.length > 0;
    if (needsGap) libnut.setKeyboardDelay(40);
    try {
      libnut.keyTap(combo.key, combo.modifiers);
    } catch (err) {
      // An unrecognised key name throws from the native binding. The text is
      // already typed, so log and carry on rather than failing the whole run.
      streamDeck.logger.error(
        `Could not press finish key combo "${settings.finishKeyCombo}"`,
        err,
      );
    } finally {
      if (needsGap) libnut.setKeyboardDelay(0);
    }
  }

  private async runTyping(
    action: KeyDownEvent<S>["action"],
    settings: S,
    longPressText: string | null,
  ): Promise<void> {
    if (this.isTyping) return;
    this.isTyping = true;
    this.abortRequested = false;

    try {
      let picked: PickResult<S>;
      if (longPressText !== null) {
        picked = { text: longPressText };
      } else {
        picked = this.pickText(settings);
      }
      if (!picked || !picked.text) return;

      // Kick off the clipboard read in parallel with expandVariables — saves a
      // subprocess round-trip on every instant-paste press.
      const originalClipboard = settings.instantType ? readClipboard() : null;

      const usesCounter = picked.text.includes("{counter}");
      const counterValue =
        toNumber(settings.counter, 0) + (usesCounter ? 1 : 0);
      const text = await expandVariables(picked.text, counterValue);

      // Persist before typing so an aborted run still advances state.
      const update: Partial<S> & Partial<BaseTypingSettings> = picked.update
        ? { ...picked.update }
        : {};
      if (usesCounter) update.counter = counterValue;
      if (Object.keys(update).length > 0) {
        await action.setSettings({ ...settings, ...update } as S);
      }

      if (settings.instantType) {
        const original = await originalClipboard;
        if (await writeClipboard(text)) {
          // libnut uses "meta" for the macOS Command key; "control" on Windows.
          const modifier = IS_MAC ? "meta" : "control";
          // libnut's keyboardDelay is 0 (set at module load) — fine for typing,
          // but with no gap between the modifier press and the key tap macOS
          // doesn't register Cmd+V. Restore a small delay just for the paste.
          libnut.setKeyboardDelay(40);
          try {
            libnut.keyTap("v", [modifier]);
          } finally {
            libnut.setKeyboardDelay(0);
          }
          // Let the target app consume the paste before we restore the clipboard.
          await sleep(150);
          if (original) await writeClipboard(original);
        } else {
          // writeClipboard unavailable (Linux) or failed — fall back to typing.
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]) libnut.typeString(lines[i]);
            if (i < lines.length - 1) libnut.keyTap("enter", []);
          }
        }
        await this.pressFinishKey(settings);
        return;
      }

      const charDelay = toNumber(settings.charDelay, DEFAULTS.charDelay);
      const wordDelay = toNumber(settings.wordDelay, DEFAULTS.wordDelay);
      const paragraphDelay = toNumber(
        settings.paragraphDelay,
        DEFAULTS.paragraphDelay,
      );
      const jitterPct = settings.jitterEnabled
        ? toNumber(settings.jitterPercent, DEFAULTS.jitterPercent)
        : 0;
      const typoChance = settings.typosEnabled
        ? toNumber(settings.typoChance, DEFAULTS.typoChance) / 100
        : 0;

      const delay = (ms: number): Promise<void> =>
        sleep(applyJitter(ms, jitterPct));

      let buffer = "";
      const flush = (): void => {
        if (buffer) {
          libnut.typeString(buffer);
          buffer = "";
        }
      };

      for (const char of text) {
        if (this.abortRequested) {
          flush();
          return;
        }
        if (char === "\r") continue;

        if (char === "\n") {
          flush();
          libnut.keyTap("enter", []);
          await delay(charDelay + paragraphDelay);
          continue;
        }

        if (typoChance > 0 && Math.random() < typoChance) {
          const wrong = adjacentKey(char);
          if (wrong) {
            flush();
            libnut.typeString(wrong);
            await delay(DEFAULTS.typoCorrectionMs);
            if (this.abortRequested) return;
            libnut.keyTap("backspace", []);
            await delay(charDelay * 2);
            if (this.abortRequested) return;
          }
        }

        buffer += char;
        if (charDelay > 0) {
          flush();
          await delay(charDelay);
        }
        if (char === " ") {
          flush();
          await delay(wordDelay);
        }
      }
      flush();
      await this.pressFinishKey(settings);
    } catch (err) {
      streamDeck.logger.error("Typing run failed", err);
      await action.showAlert();
    } finally {
      this.isTyping = false;
      this.abortRequested = false;

      if (this.queuedRun) {
        this.queuedRun = false;
        const fresh = await action.getSettings<S>();
        void this.runTyping(action, fresh, null);
      }
    }
  }
}
