// speech.js ENGINE suite (phase 2.2) — first isolated tests for the shared voice
// layer, beyond speech-overlap.test.mjs. Drives the REAL speech.js on the live
// page at :8377 with its built-in test mode (window.__testHooks -> mode "test":
// fake audio with real timing shape + window.__speechEngineLog).
//
// Hermetic like the rest of the suite: /voices disabled, /tts 503 (and COUNTED,
// to prove no fetch storm), /log swallowed. Runs under `node --test` or
// `node tests/speech-engine.test.mjs`.
//
// These tests assert CURRENT intended behavior. Where test mode cannot exercise
// a production-only path (real-audio letter cancellation), the assertion locks
// what the code observably DOES under __testHooks and the divergence is flagged
// in a comment — see the letter-vs-letter test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// A hermetic test-mode page. `counter.tts` counts every /tts request the page
// makes, so preload/short-circuit tests can assert "no fetch happened".
async function makeTestPage(browser) {
  const ctx = await browser.newContext();
  const counter = { tts: 0 };
  await ctx.route("**/log", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/voices", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false,"voices":[]}' }));
  await ctx.route("**/tts*", (r) => { counter.tts++; r.fulfill({ status: 503, body: "" }); });
  await ctx.addInitScript(() => { window.__testHooks = true; });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8377/", { waitUntil: "load" });
  await page.waitForFunction(() => window.Speech && typeof Speech.say === "function");
  await page.evaluate(() => Speech.init("test"));
  await page.evaluate(() => { window.__speechEngineLog = []; });
  return { ctx, page, counter };
}

// A page forced into mode "off": no test hooks, and speechSynthesis removed
// BEFORE speech.js loads so init()'s local self-test fails deterministically
// (fetch /voices is disabled, so eleven is skipped too).
async function makeOffPage(browser) {
  const ctx = await browser.newContext();
  const counter = { tts: 0 };
  await ctx.route("**/log", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/voices", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false,"voices":[]}' }));
  await ctx.route("**/tts*", (r) => { counter.tts++; r.fulfill({ status: 503, body: "" }); });
  await ctx.addInitScript(() => {
    try { Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true }); } catch (e) {}
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8377/", { waitUntil: "load" });
  await page.waitForFunction(() => window.Speech && typeof Speech.say === "function");
  const mode = await page.evaluate(async () => await Speech.init("hi"));
  return { ctx, page, counter, mode };
}

const log = (p) => p.evaluate(() => (window.__speechEngineLog || []).slice());

// (a) The chain plays long utterances strictly one-at-a-time: sentence B must
//     not START until sentence A has ENDED (no talking over voice).
test("chain is strictly serial for two sentences (B starts after A ends)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeTestPage(browser);
    await page.evaluate(async () => {
      Speech.say("First sentence here.");        // not awaited
      await Speech.say("Second sentence here."); // resolves when both done
    });
    const l = await log(page);
    const startA = l.find((e) => e.ev === "start" && e.text === "First sentence here.");
    const endA   = l.find((e) => e.ev === "end"   && e.text === "First sentence here.");
    const startB = l.find((e) => e.ev === "start" && e.text === "Second sentence here.");
    const endB   = l.find((e) => e.ev === "end"   && e.text === "Second sentence here.");
    assert.ok(startA && endA && startB && endB, "both sentences must fully play");
    assert.ok(startB.t >= endA.t,
      `B must start after A ends (A end ${endA.t}, B start ${startB.t})`);
    await ctx.close();
  } finally { await browser.close(); }
});

// (b) Generation counter / barge-in: say A, stop(), say B -> only B ever starts.
//     A's queued speakNow sees myGen !== gen and returns without a 'start'.
test("stop() between two sentences: the pre-stop sentence never starts (only B plays)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeTestPage(browser);
    await page.evaluate(async () => {
      Speech.say("Apple pie is ready.");   // A — queued, then invalidated
      Speech.stop();                        // user acted (gen++)
      await Speech.say("Banana bread now."); // B — the only one that should play
      await new Promise((r) => setTimeout(r, 200)); // let any leak surface
    });
    const l = await log(page);
    const startsA = l.filter((e) => e.ev === "start" && e.text === "Apple pie is ready.");
    const startB  = l.find((e)  => e.ev === "start" && e.text === "Banana bread now.");
    assert.equal(startsA.length, 0, "the pre-stop sentence must never start");
    assert.ok(startB, "the post-stop sentence must play");
    await ctx.close();
  } finally { await browser.close(); }
});

// (c) Letter-vs-letter. DOC says a new letter echo cancels the previous one
//     (stopIfLetterEcho). That cancellation acts on the real Audio /
//     speechSynthesis object — which do NOT exist in test mode — so under
//     __testHooks stopIfLetterEcho() is a no-op and BOTH echoes play,
//     overlapping. What the code OBSERVABLY does here (and what we lock):
//       * letters do NOT serialize against each other — the second echo STARTS
//         immediately, before the first's 'end' (fast typing stays snappy);
//       * both echoes still receive an 'end' (no cancellation in test mode).
//     FINDING: real-audio cancellation is only verifiable with real audio; it
//     cannot be asserted headlessly. See report.
test("letter echoes do not serialize: 2nd letter starts before 1st ends (test-mode semantics)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeTestPage(browser);
    await page.evaluate(async () => {
      Speech.say("A, ah", "letter");
      Speech.say("B, buh", "letter");   // immediate re-fire, not awaited
      await new Promise((r) => setTimeout(r, 400));
    });
    const l = await log(page);
    const starts = l.filter((e) => e.ev === "start" && e.kind === "letter");
    const ends   = l.filter((e) => e.ev === "end"   && e.kind === "letter");
    assert.equal(starts.length, 2, "both letter echoes start");
    const startFirst  = starts.find((e) => e.text === "A, ah");
    const startSecond = starts.find((e) => e.text === "B, buh");
    const endFirst    = ends.find((e)   => e.text === "A, ah");
    assert.ok(startFirst && startSecond && endFirst, "first starts+ends and second starts");
    // the 2nd letter must NOT wait for the 1st to finish (no serialization):
    assert.ok(startSecond.t < endFirst.t,
      `2nd letter must start before 1st ends (1st end ${endFirst.t}, 2nd start ${startSecond.t})`);
    // and in test mode the 1st is NOT cancelled — it still ends (documented finding):
    assert.equal(ends.length, 2, "both echoes end in test mode (cancellation is a no-op without real audio)");
    await ctx.close();
  } finally { await browser.close(); }
});

// (d.1) Empty text short-circuits: say("") returns immediately, no 'start'.
test("empty text short-circuits (logs 'say' but never 'start')", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeTestPage(browser);
    await page.evaluate(async () => {
      await Speech.say("");
      await Speech.say("   ".trim());  // "" after trim -> also empty
    });
    const l = await log(page);
    assert.equal(l.filter((e) => e.ev === "start").length, 0, "empty text must never start playback");
    await ctx.close();
  } finally { await browser.close(); }
});

// (d.2) mode "off" short-circuits: say() returns immediately and never fetches /tts.
test("mode 'off' short-circuits say() and never touches /tts", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page, counter, mode } = await makeOffPage(browser);
    assert.equal(mode, "off", "no eleven, no local voice -> mode off");
    await page.evaluate(async () => { await Speech.say("this must not play or fetch"); });
    assert.equal(counter.tts, 0, "mode off must not fetch /tts");
    await ctx.close();
  } finally { await browser.close(); }
});

// (e) preload only fetches in eleven mode: in test mode it must be a no-op
//     (no /tts fetch storm while priming clips).
test("preload is a no-op outside eleven mode (no /tts requests in test mode)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page, counter } = await makeTestPage(browser);
    await page.evaluate(async () => { await Speech.preload(["one", "two", "three", "four"]); });
    assert.equal(counter.tts, 0, "preload must not fetch /tts unless mode is eleven");
    await ctx.close();
  } finally { await browser.close(); }
});
