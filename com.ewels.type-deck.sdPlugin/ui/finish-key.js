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

  const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;
  const COMMIT_DEBOUNCE_MS = 400;

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

  // One step per line: a combo, optionally followed by that step's own delay.
  // Mirrors parseFinishKeySteps() in src/actions/base.ts.
  function parseLine(line) {
    const tokens = line
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) return null;
    let delay = "";
    const last = tokens[tokens.length - 1];
    if (tokens.length > 1 && /^\d+$/.test(last)) {
      tokens.pop();
      delay = last;
    }
    return { combo: tokens.join(""), delay };
  }

  // The visible rows are plain HTML. They serialise into a hidden
  // sdpi-textarea, which is what actually persists the setting.
  let store = null;
  let rowsEl = null;
  let enabled = false;
  let ready = false;
  let pending = null;
  let lastSerialized = null;
  let stopRecording = null;
  let commitTimer = null;

  function serialize() {
    const lines = [];
    for (const row of rowsEl.children) {
      const combo = row.querySelector(".step-combo").value.trim();
      if (!combo) continue;
      const delay = row.querySelector(".step-delay").value.trim();
      lines.push(/^\d+$/.test(delay) ? `${combo} ${delay}` : combo);
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

  function applyEnabled() {
    for (const el of document.querySelectorAll("[data-finish-key-toggle]")) {
      el.disabled = !enabled;
    }
    if (!rowsEl) return;
    for (const el of rowsEl.querySelectorAll("input, button")) {
      el.disabled = !enabled;
    }
    if (!enabled && stopRecording) stopRecording();
  }

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

  function makeRow(step) {
    const row = document.createElement("div");
    row.className = "step-row";

    const combo = document.createElement("input");
    combo.type = "text";
    combo.className = "step-combo";
    combo.placeholder = "enter";
    combo.value = step.combo;
    combo.addEventListener("input", commitSoon);
    combo.addEventListener("change", commit);

    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.className = "step-record";
    recordButton.textContent = "Record";
    recordButton.addEventListener("click", (ev) => {
      ev.preventDefault();
      record(recordButton, combo);
    });

    const delay = document.createElement("input");
    delay.type = "text";
    delay.className = "step-delay";
    delay.inputMode = "numeric";
    delay.placeholder = "ms";
    delay.title = "Delay before this step. Leave blank for the default.";
    delay.value = step.delay;
    delay.addEventListener("input", commitSoon);
    delay.addEventListener("change", commit);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "step-remove";
    remove.textContent = "×";
    remove.title = "Remove this step";
    remove.addEventListener("click", (ev) => {
      ev.preventDefault();
      row.remove();
      if (rowsEl.children.length === 0) {
        rowsEl.appendChild(makeRow({ combo: "", delay: "" }));
      }
      applyEnabled();
      commit();
    });

    row.append(combo, recordButton, delay, remove);
    return row;
  }

  function render(text) {
    if (stopRecording) stopRecording();
    rowsEl.textContent = "";
    const steps = String(text ?? "")
      .split(/\r?\n/)
      .map(parseLine)
      .filter((step) => step !== null);
    if (steps.length === 0) steps.push({ combo: "", delay: "" });
    for (const step of steps) rowsEl.appendChild(makeRow(step));
    applyEnabled();
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

  SDPIComponents.useSettings("finishKeyEnabled", (value) => {
    enabled = !!value;
    applyEnabled();
  });

  document.addEventListener("DOMContentLoaded", () => {
    store = document.querySelector('sdpi-textarea[setting="finishKeyCombo"]');
    rowsEl = document.querySelector("[data-finish-key-rows]");
    if (!store || !rowsEl) return;

    ready = true;
    render(pending);

    document
      .querySelector("[data-add-step]")
      ?.addEventListener("click", (ev) => {
        ev.preventDefault();
        rowsEl.appendChild(makeRow({ combo: "", delay: "" }));
        applyEnabled();
      });

    const cb = document.querySelector(
      'sdpi-checkbox[setting="finishKeyEnabled"]',
    );
    cb?.addEventListener("valuechange", () => {
      enabled = !!cb.value;
      applyEnabled();
    });
  });
})();
