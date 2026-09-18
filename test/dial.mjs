/**
 * Dial action checks, driven over a fake Stream Deck websocket.
 *
 *     npm test
 *
 * Spawns the built plugin, speaks the Stream Deck protocol at it and asserts on
 * the commands it sends back, so the Stream Deck + behaviour can be checked
 * without the hardware. Run `npm run build` first.
 *
 * Nothing here has any text to type: presses use an empty list so the run bails
 * before libnut is reached and no keystrokes are sent to the focused app. That
 * also means this needs a desktop session (libnut is loaded at startup), so it
 * is not wired into CI.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(REPO, "com.ewels.type-deck.sdPlugin/bin/plugin.js");

const DIAL_UUID = "com.ewels.type-deck.dial";
const TYPE_UUID = "com.ewels.type-deck.type";
const CYCLE_UUID = "com.ewels.type-deck.cycle";

const LINES = ["Hello, how are you?", "Thank you.", "Please wait.", "Bye."];
const TEXT = LINES.join("\n");

let sock;
const received = [];

/** Commands the plugin has sent since the marker, oldest first. */
function since(mark) {
  return received.slice(mark);
}

function send(msg) {
  sock.send(JSON.stringify(msg));
}

/** Give the plugin a moment to process and reply. */
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function willAppear(context, uuid, controller, settings, coordinates) {
  return {
    event: "willAppear",
    action: uuid,
    context,
    device: "dev1",
    payload: { controller, settings, coordinates, isInMultiAction: false },
  };
}

function encoderEvent(event, context, settings, extra = {}) {
  return {
    event,
    action: DIAL_UUID,
    context,
    device: "dev1",
    payload: {
      controller: "Encoder",
      settings,
      coordinates: { column: 0, row: 0 },
      ...extra,
    },
  };
}

/** Last command of a given type sent for a context. */
function last(mark, event, context) {
  return since(mark)
    .filter((m) => m.event === event && m.context === context)
    .pop();
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n      ${err.message.split("\n")[0]}`]);
  }
}

const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const port = await new Promise((r) =>
  wss.on("listening", () => r(wss.address().port)),
);

const info = {
  application: {
    font: "Arial",
    language: "en",
    platform: "mac",
    platformVersion: "15.0.0",
    version: "7.1.0",
  },
  plugin: { uuid: "com.ewels.type-deck", version: "0.3.0.0" },
  devicePixelRatio: 2,
  colors: {},
  devices: [
    {
      id: "dev1",
      name: "Stream Deck +",
      size: { columns: 4, rows: 2 },
      type: 7,
    },
  ],
};

const child = spawn(
  process.execPath,
  [
    PLUGIN,
    "-port",
    String(port),
    "-pluginUUID",
    "test-uuid",
    "-registerEvent",
    "register",
    "-info",
    JSON.stringify(info),
  ],
  {
    cwd: path.join(REPO, "com.ewels.type-deck.sdPlugin"),
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stderr.on("data", (d) => process.stderr.write(`[plugin] ${d}`));

sock = await new Promise((r) => wss.on("connection", r));
sock.on("message", (data) => received.push(JSON.parse(data.toString())));
await settle(300);

check("plugin registers over the websocket", () => {
  assert.equal(received[0]?.event, "register");
  assert.equal(received[0]?.uuid, "test-uuid");
});

// ---------------------------------------------------------------- dial: appear
let mark = received.length;
send(
  willAppear(
    "dial1",
    DIAL_UUID,
    "Encoder",
    { text: TEXT },
    { column: 0, row: 0 },
  ),
);
await settle();

check("willAppear on a dial draws the touchscreen", () => {
  const fb = last(mark, "setFeedback", "dial1");
  assert.ok(fb, "no setFeedback sent");
  assert.equal(fb.payload.count, "1 / 4");
  assert.equal(fb.payload.preview, LINES[0]);
});

check("willAppear on a dial does not fall back to setTitle", () => {
  assert.equal(last(mark, "setTitle", "dial1"), undefined);
});

// ------------------------------------------------------------- dial: rotation
mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial1",
    { text: TEXT, dialIndex: 0 },
    { ticks: 1, pressed: false },
  ),
);
await settle();

check("one tick clockwise selects the next line", () => {
  const fb = last(mark, "setFeedback", "dial1");
  assert.equal(fb.payload.count, "2 / 4");
  assert.equal(fb.payload.preview, LINES[1]);
});

check("rotation persists the index to settings", () => {
  const set = last(mark, "setSettings", "dial1");
  assert.ok(set, "no setSettings sent");
  assert.equal(set.payload.dialIndex, 1);
  assert.equal(set.payload.text, TEXT, "rotation must not drop other settings");
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial1",
    { text: TEXT, dialIndex: 1 },
    { ticks: -1, pressed: false },
  ),
);
await settle();
check("one tick counter-clockwise goes back", () => {
  assert.equal(last(mark, "setFeedback", "dial1").payload.count, "1 / 4");
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial1",
    { text: TEXT, dialIndex: 0 },
    { ticks: -1, pressed: false },
  ),
);
await settle();
check("rotating back past the first line wraps to the last", () => {
  const fb = last(mark, "setFeedback", "dial1");
  assert.equal(fb.payload.count, "4 / 4");
  assert.equal(fb.payload.preview, LINES[3]);
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial1",
    { text: TEXT, dialIndex: 3 },
    { ticks: 1, pressed: false },
  ),
);
await settle();
check("rotating past the last line wraps to the first", () => {
  assert.equal(last(mark, "setFeedback", "dial1").payload.count, "1 / 4");
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial1",
    { text: TEXT, dialIndex: 0 },
    { ticks: 6, pressed: false },
  ),
);
await settle();
check("a fast spin honours every tick (6 ticks over 4 lines)", () => {
  assert.equal(last(mark, "setFeedback", "dial1").payload.count, "3 / 4");
});

// A burst with stale settings on every event: Stream Deck has not echoed the
// first write back yet. The live index must still advance once per event.
mark = received.length;
for (let i = 0; i < 3; i++) {
  send(
    encoderEvent(
      "dialRotate",
      "dial1",
      { text: TEXT, dialIndex: 2 },
      { ticks: 1, pressed: false },
    ),
  );
}
await settle(250);
check("a burst of rotates with stale settings does not drop ticks", () => {
  const fb = last(mark, "setFeedback", "dial1");
  assert.equal(fb.payload.count, "2 / 4", "expected 3 -> 4 -> 1 -> 2");
});

// ------------------------------------------------------- dial: text edited in PI
mark = received.length;
send({
  event: "didReceiveSettings",
  action: DIAL_UUID,
  context: "dial1",
  device: "dev1",
  payload: {
    controller: "Encoder",
    settings: { text: "Only one line", dialIndex: 1 },
    coordinates: { column: 0, row: 0 },
    isInMultiAction: false,
  },
});
await settle();
check("shortening the list clamps a now out-of-range selection", () => {
  const fb = last(mark, "setFeedback", "dial1");
  assert.equal(fb.payload.count, "1 / 1");
  assert.equal(fb.payload.preview, "Only one line");
});

// ------------------------------------------------------------- dial: empty list
mark = received.length;
send(
  willAppear(
    "dial2",
    DIAL_UUID,
    "Encoder",
    { text: "" },
    { column: 1, row: 0 },
  ),
);
await settle();
check("an empty list shows a placeholder instead of crashing", () => {
  const fb = last(mark, "setFeedback", "dial2");
  assert.equal(fb.payload.count, "0 / 0");
  assert.equal(fb.payload.preview, "No text set");
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial2",
    { text: "" },
    { ticks: 3, pressed: false },
  ),
);
await settle();
check("rotating an empty list is a no-op, not a divide by zero", () => {
  assert.equal(last(mark, "setFeedback", "dial2").payload.count, "0 / 0");
  assert.equal(
    last(mark, "setSettings", "dial2"),
    undefined,
    "nothing to persist",
  );
});

// Press with nothing configured: reaches runTyping, which bails on an empty
// pick. Safe to run for real because there is nothing to type.
mark = received.length;
send(encoderEvent("dialDown", "dial2", { text: "" }));
send(encoderEvent("dialUp", "dial2", { text: "" }));
await settle(250);
check("pressing a dial with no text types nothing and shows no error", () => {
  assert.equal(last(mark, "showAlert", "dial2"), undefined);
});

// ------------------------------------------------------ dial: state is per-dial
mark = received.length;
send(
  willAppear(
    "dial3",
    DIAL_UUID,
    "Encoder",
    { text: TEXT, dialIndex: 2 },
    { column: 2, row: 0 },
  ),
);
await settle();
check("a second dial starts from its own persisted index", () => {
  assert.equal(last(mark, "setFeedback", "dial3").payload.count, "3 / 4");
});

mark = received.length;
send(
  encoderEvent(
    "dialRotate",
    "dial3",
    { text: TEXT, dialIndex: 2 },
    { ticks: 1, pressed: false },
  ),
);
await settle();
check("rotating one dial does not move another", () => {
  assert.equal(last(mark, "setFeedback", "dial3").payload.count, "4 / 4");
  assert.equal(
    last(mark, "setFeedback", "dial1"),
    undefined,
    "dial1 must not be redrawn",
  );
});

// Stale state must not survive the dial being removed from the page.
send({
  event: "willDisappear",
  action: DIAL_UUID,
  context: "dial3",
  device: "dev1",
  payload: {
    controller: "Encoder",
    settings: { text: TEXT, dialIndex: 3 },
    coordinates: { column: 2, row: 0 },
    isInMultiAction: false,
  },
});
await settle();
mark = received.length;
send(
  willAppear(
    "dial3",
    DIAL_UUID,
    "Encoder",
    { text: TEXT, dialIndex: 0 },
    { column: 2, row: 0 },
  ),
);
await settle();
check("re-appearing after willDisappear re-seeds from settings", () => {
  assert.equal(last(mark, "setFeedback", "dial3").payload.count, "1 / 4");
});

// ------------------------------------------------- regression: keypad actions
for (const [uuid, ctx] of [
  [TYPE_UUID, "key1"],
  [CYCLE_UUID, "key2"],
]) {
  mark = received.length;
  send(willAppear(ctx, uuid, "Keypad", { text: TEXT }, { column: 0, row: 1 }));
  await settle();
  check(
    `${uuid.split(".").pop()} on a keypad still sets a title preview`,
    () => {
      const title = last(mark, "setTitle", ctx);
      assert.ok(title, "no setTitle sent");
      // previewTitle() collapses every line into one and cuts at 20 chars.
      assert.equal(title.payload.title, "Hello, how are you? \u2026");
      assert.equal(
        last(mark, "setFeedback", ctx),
        undefined,
        "keys must not get feedback",
      );
    },
  );
}

mark = received.length;
send({
  event: "didReceiveSettings",
  action: TYPE_UUID,
  context: "key1",
  device: "dev1",
  payload: {
    controller: "Keypad",
    settings: { text: "Changed in the PI" },
    coordinates: { column: 0, row: 1 },
    isInMultiAction: false,
  },
});
await settle();
check("editing a key's text in the PI still refreshes its title", () => {
  assert.equal(
    last(mark, "setTitle", "key1").payload.title,
    "Changed in the PI",
  );
});

check("plugin is still alive at the end", () => {
  assert.equal(child.exitCode, null);
});

// ------------------------------------------------------------------ report
console.log("");
for (const [status, name] of results) {
  console.log(`  ${status === "PASS" ? "[32m✓[0m" : "[31m✗[0m"} ${name}`);
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);

child.kill();
wss.close();
process.exit(failed === 0 ? 0 : 1);
