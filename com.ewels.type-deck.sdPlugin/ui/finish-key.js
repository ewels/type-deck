(() => {
  // Maps a KeyboardEvent to the key name that libnut's keyTap understands.
  // `code` is used rather than `key` so that holding Shift still records the
  // physical key (Shift+1 is "shift+1", not "shift+!").
  const CODE_TO_KEY = {
    Enter: "enter",
    NumpadEnter: "enter",
    Tab: "tab",
    Space: "space",
    Escape: "escape",
    Backspace: "backspace",
    Delete: "delete",
    Insert: "insert",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    PrintScreen: "printscreen",
    ContextMenu: "menu",
    CapsLock: "caps_lock",
    NumLock: "num_lock",
    ScrollLock: "scroll_lock",
    NumpadDecimal: "numpad_decimal",
    NumpadSubtract: "subtract",
    NumpadMultiply: "multiply",
    NumpadDivide: "divide",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    IntlBackslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };

  for (let i = 1; i <= 24; i++) CODE_TO_KEY[`F${i}`] = `f${i}`;
  for (let i = 0; i <= 9; i++) {
    CODE_TO_KEY[`Digit${i}`] = String(i);
    CODE_TO_KEY[`Numpad${i}`] = `numpad_${i}`;
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    CODE_TO_KEY[`Key${letter.toUpperCase()}`] = letter;
  }

  // Key names libnut accepts that no physical key press maps to, so they are
  // absent from CODE_TO_KEY but still valid when typed by hand.
  const VALID_KEYS = new Set([
    ...Object.values(CODE_TO_KEY),
    "add",
    "clear",
    "numpad_equal",
    "return",
    "fn",
    "right_alt",
    "right_cmd",
    "right_control",
    "right_meta",
    "right_shift",
    "right_win",
    "audio_mute",
    "audio_vol_down",
    "audio_vol_up",
    "audio_play",
    "audio_pause",
    "audio_stop",
    "audio_next",
    "audio_prev",
    "audio_rewind",
    "audio_forward",
    "audio_repeat",
    "audio_random",
  ]);

  // Mirrors MODIFIER_ALIASES in src/actions/base.ts.
  const MODIFIER_TOKENS = new Set([
    "ctrl",
    "control",
    "alt",
    "option",
    "opt",
    "shift",
    "meta",
    "cmd",
    "command",
    "super",
    "win",
  ]);

  const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
  const COMMIT_DEBOUNCE_MS = 400;
  const COMBO_HINT =
    "A key name such as enter, tab, escape, f5, up or a single character, " +
    "optionally after modifiers: meta+shift+enter.";

  // Order matters: it is the canonical form the plugin stores.
  function modifiersOf(ev) {
    const mods = [];
    if (ev.ctrlKey) mods.push("control");
    if (ev.altKey) mods.push("alt");
    if (ev.shiftKey) mods.push("shift");
    if (ev.metaKey) mods.push("meta");
    return mods;
  }

  function keyNameOf(ev) {
    const mapped = CODE_TO_KEY[ev.code];
    if (mapped) return mapped;
    // Unmapped but printable (non-US layouts, exotic punctuation).
    if (ev.key && ev.key.length === 1 && ev.key !== " " && ev.key !== "+") {
      return ev.key.toLowerCase();
    }
    return null;
  }

  // One combo per line. A trailing number is a per-step delay from an earlier
  // build; it is dropped. Mirrors parseFinishKeyCombos() in src/actions/base.ts.
  function parseLine(line) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    if (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return tokens.join("");
  }

  // The visible rows are plain HTML. They serialise into a hidden
  // sdpi-textarea, which is what actually persists the setting.
  let store = null;
  let rowsEl = null;
  let ready = false;
  let pending = null;
  let lastSerialized = null;
  let stopRecording = null;
  let commitTimer = null;

  // Built here rather than in the HTML so it can ride along at the end of the
  // last row, instead of in an sdpi-item with an empty label.
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "step-add";
  addButton.textContent = "+";
  addButton.title = "Add another step";
  addButton.addEventListener("click", (ev) => {
    ev.preventDefault();
    rowsEl.appendChild(makeRow(""));
    placeAddButton();
  });

  // The button lives in the last row, so it moves whenever the rows change.
  function placeAddButton() {
    rowsEl.lastElementChild?.appendChild(addButton);
  }

  function serialize() {
    const lines = [];
    for (const row of rowsEl.querySelectorAll(".step-combo")) {
      const combo = row.value.trim();
      if (combo) lines.push(combo);
    }
    return lines.join("\n");
  }

  function commit() {
    clearTimeout(commitTimer);
    const text = serialize();
    if (text === lastSerialized) return;
    lastSerialized = text;
    store.value = text;
  }

  const commitSoon = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commit, COMMIT_DEBOUNCE_MS);
  };

  function record(button, input) {
    if (stopRecording) stopRecording();
    const idleLabel = button.textContent;

    const stop = () => {
      stopRecording = null;
      button.textContent = idleLabel;
      button.classList.remove("recording");
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    };

    // Live preview of the modifiers held so far, so a combo in progress is
    // visible before the final key lands.
    const preview = (ev) => {
      const mods = modifiersOf(ev);
      button.textContent = mods.length ? `${mods.join("+")}+` : "Press keys";
    };

    function onKeyDown(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (MODIFIER_CODES.test(ev.code)) {
        preview(ev);
        return;
      }
      const key = keyNameOf(ev);
      if (!key) {
        preview(ev);
        return;
      }
      input.value = [...modifiersOf(ev), key].join("+");
      validate(input);
      stop();
      commit();
    }

    function onKeyUp(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (MODIFIER_CODES.test(ev.code)) preview(ev);
    }

    stopRecording = stop;
    button.textContent = "Press keys";
    button.classList.add("recording");
    button.blur();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stop);
  }

  // The key a combo resolves to, the same way parseKeyCombo() in base.ts does
  // it. Null when there is no key, or more than one: a combo is modifiers plus
  // exactly one key, so a typo'd modifier ("shiftt+enter") is not a combo.
  function keyOf(combo) {
    const keys = combo
      .split("+")
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p && !MODIFIER_TOKENS.has(p));
    return keys.length === 1 ? keys[0] : null;
  }

  // An unknown key name throws from the native binding at press time and the
  // step is silently skipped, so flag it here instead.
  function validate(input) {
    const combo = input.value.trim();
    const key = combo ? keyOf(combo) : null;
    const ok =
      !combo || (key !== null && (VALID_KEYS.has(key) || key.length === 1));
    input.classList.toggle("invalid", !ok);
    input.title = ok
      ? COMBO_HINT
      : `"${combo}" is not a key Stream Deck can press. ${COMBO_HINT}`;
  }

  function makeRow(value) {
    const row = document.createElement("div");
    row.className = "step-row";

    const combo = document.createElement("input");
    combo.type = "text";
    combo.className = "step-combo";
    combo.placeholder = "e.g. shift+tab";
    combo.value = value;
    combo.addEventListener("input", () => {
      validate(combo);
      commitSoon();
    });
    combo.addEventListener("change", commit);
    validate(combo);

    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className = "step-record";
    recordButton.textContent = "Record";
    recordButton.addEventListener("click", (ev) => {
      ev.preventDefault();
      record(recordButton, combo);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "step-remove";
    remove.textContent = "×";
    remove.title = "Remove this step";
    remove.addEventListener("click", (ev) => {
      ev.preventDefault();
      row.remove();
      if (rowsEl.children.length === 0) rowsEl.appendChild(makeRow(""));
      placeAddButton();
      commit();
    });

    row.append(recordButton, combo, remove);
    return row;
  }

  function render(text) {
    if (stopRecording) stopRecording();
    rowsEl.textContent = "";
    const combos = String(text ?? "")
      .split(/\r?\n/)
      .map(parseLine)
      .filter((combo) => combo !== null);
    if (combos.length === 0) combos.push("");
    for (const combo of combos) rowsEl.appendChild(makeRow(combo));
    placeAddButton();
  }

  // Subscribe at module scope: sdpi-components broadcasts the saved settings
  // once, and a listener registered after that broadcast never hears it.
  SDPIComponents.useSettings("finishKeyCombo", (value) => {
    const text = typeof value === "string" ? value : "";
    // Ignore the echo of our own write, which would rebuild the rows under the
    // user and lose the caret mid-edit.
    if (text === lastSerialized) return;
    lastSerialized = text;
    if (!ready) {
      pending = text;
      return;
    }
    render(text);
  });

  document.addEventListener("DOMContentLoaded", () => {
    store = document.querySelector('sdpi-textarea[setting="finishKeyCombo"]');
    rowsEl = document.querySelector("[data-finish-key-rows]");
    if (!store || !rowsEl) return;

    ready = true;
    render(pending);
  });
})();
