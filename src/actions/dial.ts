import {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import {
  BaseTypeAction,
  type BaseTypingSettings,
  type PickResult,
  splitLines,
  type TypeActionTarget,
  toNumber,
} from "./base";

type DialSettings = BaseTypingSettings & {
  dialIndex?: number;
};

/** Shown on the touchscreen when there are no lines to pick from. */
const EMPTY_PREVIEW = "No text set";

/** Wrap an index into 0..length-1, for negative values too. */
function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

@action({ UUID: "com.ewels.type-deck.dial" })
export class DialPickAction extends BaseTypeAction<DialSettings> {
  /**
   * Live selection per dial, keyed by action id.
   *
   * Rotation maths runs off this rather than off `payload.settings`, because a
   * fast spin delivers several dialRotate events before Stream Deck has echoed
   * back the settings written for the first one. Reading the stale settings
   * each time would drop ticks. Settings are still written on every rotate, and
   * are what `pickText` reads on press (by then the spin has long settled) and
   * what survives a restart.
   */
  readonly #selected = new Map<string, number>();

  #indexFor(action: TypeActionTarget<DialSettings>, lines: string[]): number {
    const live = this.#selected.get(action.id);
    return wrap(live ?? 0, lines.length);
  }

  protected override pickText(
    settings: DialSettings,
  ): PickResult<DialSettings> {
    const lines = splitLines(settings.text ?? "");
    if (lines.length === 0) return null;
    return { text: lines[wrap(toNumber(settings.dialIndex, 0), lines.length)] };
  }

  /**
   * Draw the current selection on the dial's touchscreen. Long lines are cut by
   * the layout's `text-overflow`, so there is nothing to truncate here.
   */
  protected override updateDisplay(
    action: TypeActionTarget<DialSettings>,
    settings: DialSettings,
  ): Promise<void> {
    const lines = splitLines(settings.text ?? "");
    // Seed from the persisted value the first time this dial is seen; after
    // that the in-memory selection is authoritative.
    if (!this.#selected.has(action.id)) {
      this.#selected.set(
        action.id,
        wrap(toNumber(settings.dialIndex, 0), lines.length),
      );
    }
    const index = this.#indexFor(action, lines);

    if (!action.isDial()) return action.setTitle(lines[index] ?? "");
    return action.setFeedback({
      count: lines.length > 0 ? `${index + 1} / ${lines.length}` : "0 / 0",
      preview: lines[index] ?? EMPTY_PREVIEW,
    });
  }

  override async onDialRotate(
    ev: DialRotateEvent<DialSettings>,
  ): Promise<void> {
    const { settings } = ev.payload;
    const lines = splitLines(settings.text ?? "");
    if (lines.length === 0) {
      await this.updateDisplay(ev.action, settings);
      return;
    }

    // `ticks` is signed, and is more than 1 for a fast spin.
    const next = wrap(
      this.#indexFor(ev.action, lines) + ev.payload.ticks,
      lines.length,
    );
    this.#selected.set(ev.action.id, next);

    await ev.action.setSettings({ ...settings, dialIndex: next });
    await this.updateDisplay(ev.action, { ...settings, dialIndex: next });
  }

  override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
    const { settings } = ev.payload;
    if (this.handleRepeatPress(settings)) return;
    // Settings can lag a rotate that landed moments ago, so type from the live
    // selection rather than whatever index the event happens to carry.
    const lines = splitLines(settings.text ?? "");
    const dialIndex = this.#indexFor(ev.action, lines);
    await this.runTyping(ev.action, { ...settings, dialIndex }, null);
  }

  override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
    this.#selected.delete(ev.action.id);
  }
}
