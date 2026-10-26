/**
 * End-to-end typing checks on Windows, driven over a fake Stream Deck websocket.
 *
 *     PLUGIN_DIR=path/to/com.ewels.type-deck.sdPlugin node test/e2e-windows.mjs
 *
 * Opens a focused text box (test/e2e-target.ps1), spawns the plugin, presses
 * Type text keys at it and asserts on what actually lands in the box. Unlike
 * test/dial.mjs this really types, through libnut and the clipboard, so it
 * exercises the native binding and the packaged node_modules.
 *
 * PLUGIN_DIR defaults to the repo's plugin folder; CI points it at the unpacked
 * .streamDeckPlugin so the release artifact itself is what gets tested.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = path.resolve(
  process.env.PLUGIN_DIR ?? path.join(REPO, "com.ewels.type-deck.sdPlugin"),
);
const TYPE_UUID = "com.ewels.type-deck.type";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "type-deck-e2e-"));
const OUT = path.join(work, "out.txt");
const READY = path.join(work, "ready.txt");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** What is in the text box right now, with Windows newlines folded. */
function boxText() {
  try {
    return fs
      .readFileSync(OUT, "utf-8")
      .replace(/^﻿/, "")
      .replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}

// ------------------------------------------------------------- target window
const target = spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-STA",
    "-File",
    path.join(REPO, "test/e2e-target.ps1"),
    "-OutFile",
    OUT,
    "-ReadyFile",
    READY,
  ],
  { stdio: "inherit" },
);
await waitFor(() => fs.existsSync(READY), 30000, "the target window");
await sleep(500);

// -------------------------------------------------------------------- plugin
const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const port = await new Promise((r) =>
  wss.on("listening", () => r(wss.address().port)),
);

const info = {
  application: {
    font: "Segoe UI",
    language: "en",
    platform: "windows",
    platformVersion: os.release(),
    version: "7.1.0",
  },
  plugin: { uuid: "com.ewels.type-deck", version: "0.0.0.0" },
  devicePixelRatio: 1,
  colors: {},
  devices: [
    { id: "dev1", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 },
  ],
};

console.log(`Plugin: ${PLUGIN_DIR}`);
const child = spawn(
  process.execPath,
  [
    path.join(PLUGIN_DIR, "bin/plugin.js"),
    "-port",
    String(port),
    "-pluginUUID",
    "test-uuid",
    "-registerEvent",
    "register",
    "-info",
    JSON.stringify(info),
  ],
  { cwd: PLUGIN_DIR, stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.on("data", (d) => process.stdout.write(`[plugin] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[plugin] ${d}`));
let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
  console.error(`[plugin] exited: code=${code} signal=${signal}`);
});

const received = [];
let sock;
wss.on("connection", (s) => {
  sock = s;
});
await waitFor(() => sock || exited, 20000, "the plugin to connect");
if (!sock) throw new Error("plugin exited before connecting to Stream Deck");
sock.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  received.push(msg);
  if (msg.event === "showAlert") console.error("[plugin] showAlert");
});
const send = (msg) => sock.send(JSON.stringify(msg));
await sleep(500);

// --------------------------------------------------------------------- cases
// No delays, so each run is quick and nothing depends on timing.
const FAST = { charDelay: "0", wordDelay: "0", paragraphDelay: "0" };

let n = 0;
async function press(settings) {
  const context = `key${++n}`;
  const payload = {
    controller: "Keypad",
    settings,
    coordinates: { column: n % 5, row: 0 },
    isInMultiAction: false,
  };
  const base = { action: TYPE_UUID, context, device: "dev1" };
  send({ ...base, event: "willAppear", payload });
  await sleep(100);
  send({ ...base, event: "keyDown", payload });
  send({ ...base, event: "keyUp", payload });
  return context;
}

const RUN_TAIL_MS = 2000;

const results = [];
async function typeCase(name, settings, expected) {
  const before = boxText();
  const mark = received.length;
  try {
    const context = await press({ ...FAST, ...settings });
    const want = before + expected;
    try {
      await waitFor(() => boxText() === want, 10000, "the typed text");
    } catch {
      // Report what did arrive rather than just "timed out".
      const got = JSON.stringify(boxText().slice(before.length));
      throw new Error(`typed ${got}, expected ${JSON.stringify(expected)}`);
    }
    // The text lands before the run ends (the clipboard restore and finish
    // keys come after it). A press before then would cancel the run instead.
    await sleep(RUN_TAIL_MS);
    const alert = received
      .slice(mark)
      .find((m) => m.event === "showAlert" && m.context === context);
    assert.equal(alert, undefined, "plugin showed an alert");
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n      ${err.message.split("\n")[0]}`]);
  }
}

// The clipboard is read and written here independently of the plugin's own
// helpers, with explicit UTF-8 so the check cannot share their encoding bug.
const PS_UTF8 =
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false";

function setClipboard(text) {
  // Base64 keeps the text clear of both quoting and code pages.
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')))`,
  ]);
}

function getClipboard() {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `${PS_UTF8}; Get-Clipboard -Raw`],
    { encoding: "utf-8" },
  ).replace(/\r?\n$/, "");
}

function clipboardCase(name, expected) {
  try {
    assert.equal(getClipboard(), expected);
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", `${name}\n      ${err.message.split("\n")[0]}`]);
  }
}

await typeCase(
  "types plain ASCII",
  { text: "Hello World 123" },
  "Hello World 123",
);
await typeCase(
  "types a newline as Enter",
  { text: "\nline one\nline two" },
  "\nline one\nline two",
);
await typeCase(
  "types shifted punctuation",
  { text: ' !@#$%^&*()_+{}:"<>?' },
  ' !@#$%^&*()_+{}:"<>?',
);
const KEEP = "on the clipboard before ✓";
setClipboard(KEEP);
await typeCase(
  "types non-ASCII through the clipboard (issue #1)",
  { text: " café ünïcødé €" },
  " café ünïcødé €",
);
clipboardCase("restores the clipboard after pasting non-ASCII", KEEP);
await typeCase(
  "instant type pastes the text",
  { text: " instant paste", instantType: true },
  " instant paste",
);
clipboardCase("restores the clipboard after an instant type", KEEP);
await typeCase(
  "finish key presses Enter after typing",
  { text: " finished", finishKeyCombo: "enter" },
  " finished\n",
);

results.push(
  exited === null
    ? ["PASS", "plugin is still alive at the end"]
    : [
        "FAIL",
        `plugin is still alive at the end\n      exited ${JSON.stringify(exited)}`,
      ],
);

// -------------------------------------------------------------------- report
console.log("");
for (const [status, name] of results) {
  console.log(
    `  ${status === "PASS" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${name}`,
  );
}
const failed = results.filter(([s]) => s === "FAIL").length;
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
console.log(`Final text box contents:\n${JSON.stringify(boxText())}\n`);

child.kill();
target.kill();
wss.close();
process.exit(failed === 0 ? 0 : 1);
