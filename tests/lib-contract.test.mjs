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
import { CONTRACT, holdFor, holdForDoor, assertContract } from "../public/lib/contract.js";

// ---- the ux-contract §C table, hardcoded (the source of truth for this test) ----
const EXPECTED_SIZES = {
  fontFloor: 74, fontMin: 44, fontCap: 112, gapFloor: 28, gapWarn: 34,
  sidePadBoard: 40, sidePadMakingWords: 60, vPad: 20, barH: 140,
  gapFrac: 0.22, trayBand: 0.30, parkUnits: 0.55,
  photoLabelShare: 0.20, photoPlateMin: 52, photoFontCap: 46, photoFontMin: 24,
};
const EXPECTED_HOLDS = {
  supportRead: 1000, content: 1200, navBonus: 400, navMin: 1600, answer: 1600,
  backspace: 1800, clear: 2000, send: 2200, exit: 2400, floor: 800,
  tuneMax: 3000, boardRuntimeMin: 600,
};
const EXPECTED_DWELL = { ms: 1200, graceMs: 400, decayMs: 1000, padPx: 16, rearmPx: 48, staleMs: 600 };

test("sizes match ux-contract §C", () => {
  for (const [k, v] of Object.entries(EXPECTED_SIZES)) assert.equal(CONTRACT.sizes[k], v, k);
});

test("holds ladder matches ux-contract §C/§D", () => {
  for (const [k, v] of Object.entries(EXPECTED_HOLDS)) assert.equal(CONTRACT.holds[k], v, k);
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

test("door rule: holdForDoor(1200)===1600 && holdForDoor(1400)===1800", () => {
  assert.equal(holdForDoor(1200), 1600); // content+400=1600 == floor
  assert.equal(holdForDoor(1400), 1800); // content+400=1800 > floor
  assert.equal(CONTRACT.holds.holdForDoor(1200), 1600); // same fn on the contract
});

test("holdFor(type) maps roles to the ladder", () => {
  assert.equal(holdFor("content"), 1200);
  assert.equal(holdFor("word"), 1600);
  assert.equal(holdFor("clear"), 2000);
  assert.equal(holdFor("exit"), 2400);
  assert.equal(holdFor("nonsense"), 1200); // unknown -> content fallback
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
  const jsonPath = fileURLToPath(new URL("../public/lib/contract.json", import.meta.url));
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
