/*
 * lib-contract.test.mjs — smoke test for lib/contract.js (Phase 2.1).
 * No browser: pure node:test.  The EXPECTED numbers below are hardcoded from
 * knowledge/ux-contract.md §C — this test IS the cross-check that contract.js
 * still mirrors the doc.  Run:  node --test tests/lib-contract.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This suite runs from two places — the gate's assembled layout (era-hub/gate/,
// where ../public/lib is a symlink to era-core/lib) and, in place, the era-core
// worktree's own tests/ dir. Try both (board-pixel.test.mjs:23 idiom).
const LIB = await (async () => {
  for (const p of ["../public/lib/", "../lib/"]) {
    try { await import(new URL(p + "contract.js", import.meta.url)); return new URL(p, import.meta.url); }
    // only "no file at this path" means try the other layout — a syntax error
    // inside contract.js must surface as itself, not as "not found".
    catch (err) { if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err; }
  }
  throw new Error("lib/contract.js not found from " + import.meta.url);
})();
const { CONTRACT, holdFor, holdForExit, assertContract } =
  await import(new URL("contract.js", LIB));

// ---- the ux-contract §C table, hardcoded (the source of truth for this test) ----
const EXPECTED_SIZES = {
  fontFloor: 74, fontMin: 44, fontCap: 112,
  gapFloor: 14, gapWarn: 14,        // §24 AMENDED 9/5: Ellie's own tablet's gap (~1% of screen
                                    // width) — dad "you put too much spacing between the tiles".
                                    // gapWarn == gapFloor: the warn band is retired, because the
                                    // board draws exactly the floor and a higher warn would fire
                                    // on every pair on every page.
  sidePadBoard: 28, vPad: 12,       // §24 measured off her tablet's photo (dad 9/5)
  sidePadMakingWords: 60, barH: 124,  // 140 ate the grid on a 13" 1080p board; 110 is the slimmest
                                    // bar that keeps the exit door >= the 90px target floor (dad 9/1)
  gapFrac: 0.22, trayBand: 0.30, parkUnits: 0.55,
  photoLabelShare: 0.20, photoPlateMin: 52, photoFontCap: 46, photoFontMin: 24,
};
// Two speeds since dad's 9/17 ruling (§C): everything holds `dwell`, the two
// doors that leave the screen hold 2x it. The invented content<nav<answer<
// backspace<clear<send<exit rungs are GONE from the whitelist on purpose.
const EXPECTED_HOLDS = {
  supportRead: 1000, content: 1200, floor: 800, tuneMax: 3000, boardRuntimeMin: 600,
};
// Rungs removed 9/17 — a rung nobody may use must not exist to be reached for.
const REMOVED_HOLDS = ["navBonus", "navMin", "answer", "backspace", "clear",
                       "send", "exit", "holdForDoor"];
const EXPECTED_DWELL = { ms: 1200, graceMs: 400, decayMs: 1000, padPx: 16, rearmPx: 48, staleMs: 600 };

test("sizes match ux-contract §C", () => {
  for (const [k, v] of Object.entries(EXPECTED_SIZES)) assert.equal(CONTRACT.sizes[k], v, k);
});

test("holds set matches ux-contract §C/§D", () => {
  for (const [k, v] of Object.entries(EXPECTED_HOLDS)) assert.equal(CONTRACT.holds[k], v, k);
});

test("the removed rungs are gone (whitelist: no rung to reach for) — dad 9/17", () => {
  for (const k of REMOVED_HOLDS) assert.equal(CONTRACT.holds[k], undefined, k);
  assert.deepEqual(
    Object.keys(CONTRACT.holds).sort(),
    ["boardRuntimeMin", "content", "floor", "holdForExit", "supportRead", "tuneMax"],
    "holds carries exactly the five numbers plus holdForExit");
});

test("dwell engine defaults match ux-contract §C (staleMs=600 per §E-5 Gate-2 ruling)", () => {
  for (const [k, v] of Object.entries(EXPECTED_DWELL)) assert.equal(CONTRACT.dwellEngine[k], v, k);
  assert.equal(CONTRACT.dwellEngine.chime, false, "chime OFF §10");
  assert.equal(CONTRACT.dwellEngine.audioPreview, false, "audioPreview OFF §10");
  assert.equal(CONTRACT.dwellEngine.gazeBus, "ws://127.0.0.1:49155", "bus §E-8");
});

test("maxChoices, park corner, nav anchors, speech, devices", () => {
  assert.deepEqual(CONTRACT.maxChoices, { ideal: 2, comfortable: 12, cap: 16 });
  assert.deepEqual(CONTRACT.parkCorner, { x01: 0.995, y01: 0.995, inert: true });
  assert.deepEqual(CONTRACT.navAnchors,
    { more: "bottom-left", exit: "bottom-right", boardDoor: "top-left",
      back: "top-left", restCells: "center" });
  assert.equal(CONTRACT.speech.bargeIn, "stop-before-say");
  assert.equal(CONTRACT.speech.serialization, "sentence-waits-for-letter-echo");
  assert.deepEqual(CONTRACT.devices, [{ w: 1920, h: 1080 }, { w: 2736, h: 1824 }]);
});

test("exit rule (dad 9/17): holdForExit(dwell) === 2 * dwell", () => {
  assert.equal(holdForExit(1200), 2400); // today's Settings default — nothing she learned moves
  assert.equal(holdForExit(600), 1200);  // the fastest she can be set to
  assert.equal(holdForExit(3000), 6000); // the slowest
  assert.equal(CONTRACT.holds.holdForExit(1200), 2400); // same fn on the contract
});

test("holdFor(role, dwell): two speeds, everything else is dwell", () => {
  assert.equal(holdFor("content", 900), 900);
  assert.equal(holdFor("word", 900), 900);
  assert.equal(holdFor("clear", 900), 900);
  assert.equal(holdFor("backspace", 900), 900);
  assert.equal(holdFor("send", 900), 900);
  assert.equal(holdFor("nonsense", 900), 900);        // unknown role = a control = dwell
  assert.equal(holdFor("exit", 900), 1800);           // the door: 2 x dwell
  assert.equal(holdFor("exit", 1200), 2400);
  assert.equal(holdFor("talk", 1200), 2400);          // 💬 is the other door
  assert.equal(holdFor("supportRead", 900), 1000);    // reading, not selecting
  assert.equal(holdFor("prediction", 900), 2000);     // reading three, not picking one
  assert.equal(holdFor("content"), 1200);             // no dwell given -> contract default
  assert.equal(holdFor("exit"), 2400);                // ... and the door is still 2x it
  assert.equal(holdFor("send", "nope"), 1200);        // garbage dwell -> content fallback
  assert.equal(holdFor("exit", NaN), 2400);
});

test("assertContract is a no-op placeholder returning its arg", () => {
  const sentinel = {};
  assert.equal(assertContract(sentinel), sentinel);
});

test("CONTRACT is deep-frozen (whitelist cannot mutate)", () => {
  assert.ok(Object.isFrozen(CONTRACT));
  assert.ok(Object.isFrozen(CONTRACT.sizes));
  assert.ok(Object.isFrozen(CONTRACT.holds));
  assert.ok(Object.isFrozen(CONTRACT.dwellEngine));
  assert.ok(Object.isFrozen(CONTRACT.navAnchors));
  assert.ok(Object.isFrozen(CONTRACT.devices[0]));
  assert.throws(() => { CONTRACT.sizes.fontFloor = 1; }, TypeError);
});

test("contract.json is in sync with contract.js (regenerate via tools/gen-contract-json.mjs)", () => {
  const jsonPath = fileURLToPath(new URL("contract.json", LIB));
  const onDisk = readFileSync(jsonPath, "utf8");
  const expected = JSON.stringify(CONTRACT, null, 2) + "\n"; // JSON drops fn-valued keys
  assert.equal(onDisk, expected, "contract.json stale — run: node tools/gen-contract-json.mjs");
});

// --- ERAgaze (C#) contract mirrors — the engine can't import contract.js, so
// its hand-mirrored constants get the same drift protection as everything else.
import { dirname, join } from "node:path";
// era layout: the engine source lives in the sibling era-gaze repo (or point
// ERA_GAZE_SRC at another checkout). Skips cleanly when absent.
const GAZE = process.env.ERA_GAZE_SRC ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "era-gaze");
import { existsSync } from "node:fs";
const HAS_GAZE = existsSync(join(GAZE, "device", "ERAgaze.cs"));
const HAS_TWIN = existsSync(join(GAZE, "RaeGaze.cs"));

test("ERAgaze.cs and RaeGaze.cs are byte-identical twins (no silent drift)", { skip: !HAS_TWIN }, () => {
  const a = readFileSync(join(GAZE, "device", "ERAgaze.cs"), "utf8");
  const b = readFileSync(join(GAZE, "RaeGaze.cs"), "utf8");
  assert.equal(a, b, "packages/gaze/RaeGaze.cs must exactly equal packages/gaze/device/ERAgaze.cs — edit device/, copy over");
});

test("ERAgaze constants mirror the contract (park corner, bus port)", { skip: !HAS_GAZE }, () => {
  const cs = readFileSync(join(GAZE, "device", "ERAgaze.cs"), "utf8");
  const park = cs.match(/ParkX01 = ([\d.]+), ParkY01 = ([\d.]+)/);
  assert.ok(park, "ParkX01/ParkY01 defaults not found");
  assert.equal(+park[1], CONTRACT.parkCorner.x01, "engine ParkX01 vs contract");
  assert.equal(+park[2], CONTRACT.parkCorner.y01, "engine ParkY01 vs contract");
  const port = cs.match(/Port = (\d+);/);
  assert.ok(port, "bus Port default not found");
  assert.ok(CONTRACT.dwellEngine.gazeBus.includes(":" + port[1]), "engine bus port vs contract gazeBus");
});
