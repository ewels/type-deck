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

  // Order matters: it is the canonical form the plugin stores and displays.
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

  document.addEventListener("DOMContentLoaded", () => {
    const field = document.querySelector(
      'sdpi-textfield[setting="finishKeyCombo"]',
    );
    const button = document.querySelector("[data-record-combo]");
    const clear = document.querySelector("[data-clear-combo]");
    if (!field || !button) return;

    const IDLE_LABEL = button.textContent;
    let recording = false;

    const stop = () => {
      if (!recording) return;
      recording = false;
      button.textContent = IDLE_LABEL;
      button.classList.remove("recording");
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
    };

    // Live preview of the modifiers held so far, so a combo in progress is
    // visible before the final key lands.
    const preview = (ev) => {
      const mods = modifiersOf(ev);
      button.textContent = mods.length
        ? `${mods.join("+")}+...`
        : "Press keys...";
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
      field.value = [...modifiersOf(ev), key].join("+");
      stop();
    }

    function onKeyUp(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (MODIFIER_CODES.test(ev.code)) preview(ev);
    }

    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (recording) {
        stop();
        return;
      }
      recording = true;
      button.textContent = "Press keys...";
      button.classList.add("recording");
      button.blur();
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
      window.addEventListener("blur", stop);
    });

    clear?.addEventListener("click", (ev) => {
      ev.preventDefault();
      stop();
      field.value = "";
    });
  });

  // Grey out the combo controls until the feature is switched on.
  const applyEnabled = (enabled) => {
    for (const el of document.querySelectorAll("[data-finish-key-toggle]")) {
      el.disabled = !enabled;
    }
  };

  SDPIComponents.useSettings("finishKeyEnabled", applyEnabled);

  document.addEventListener("DOMContentLoaded", () => {
    const cb = document.querySelector(
      'sdpi-checkbox[setting="finishKeyEnabled"]',
    );
    cb?.addEventListener("valuechange", () => applyEnabled(cb.value));
  });
})();
