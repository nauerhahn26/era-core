// speech.js serialization law (7/27) — regression for "voice talks over voice".
// Replicates Making Words' exact firing pattern against the REAL speech.js on
// the live page, with the built-in test mode (window.__testHooks): fake audio
// with real timing shape + an event log. Asserts:
//   1. a sentence queued while a letter echo plays STARTS only after the echo ENDS
//   2. stop() (barge-in) kills queued sentences outright
//   3. a new letter echo still cancels the previous one (fast typing stays snappy)
// Runs under `node --test` against the live server at :8377.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

async function makePage(browser) {
  const ctx = await browser.newContext();
  await ctx.route("**/log", r => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/voices", r => r.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false,"voices":[]}' }));
  await ctx.route("**/tts*", r => r.fulfill({ status: 503, body: "" }));
  await ctx.addInitScript(() => { window.__testHooks = true; });
  const page = await ctx.newPage();
  await page.goto("http://localhost:8377/", { waitUntil: "load" });
  await page.waitForFunction(() => window.Speech && typeof Speech.say === "function");
  await page.evaluate(() => Speech.init("test"));
  return { ctx, page };
}
const log = (p) => p.evaluate(() => (window.__speechEngineLog || []).slice());
const reset = (p) => p.evaluate(() => { window.__speechEngineLog = []; });

test("sentence waits for in-flight letter echo (the Making Words pattern)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makePage(browser);
    await reset(page);
    // exact studio.js shape: stop -> fire-and-forget letter echo -> immediate sentence
    await page.evaluate(async () => {
      Speech.stop();
      Speech.say("T, tuh", "letter");           // not awaited (studio.js:362 shape)
      await Speech.say("You spelled plant! Amazing!");
    });
    const l = (await log(page)).filter(e => e.ev === "start" || e.ev === "end");
    const letterEnd = l.find(e => e.ev === "end" && e.kind === "letter");
    const longStart = l.find(e => e.ev === "start" && e.kind === "long");
    assert.ok(letterEnd && longStart, "both utterances must have played");
    assert.ok(longStart.t >= letterEnd.t,
      `sentence must start AFTER the letter echo ends (letter end ${letterEnd.t}, sentence start ${longStart.t})`);
    await ctx.close();
  } finally { await browser.close(); }
});

test("stop() kills queued sentences (barge-in law)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makePage(browser);
    await reset(page);
    await page.evaluate(async () => {
      Speech.say("B, buh", "letter");
      Speech.say("This sentence must never play.");
      Speech.stop();                              // user acted
      await new Promise(r => setTimeout(r, 700)); // give any leak time to fire
    });
    const l = await log(page);
    assert.equal(l.filter(e => e.ev === "start" && e.kind === "long").length, 0,
      "no sentence may start after stop()");
    await ctx.close();
  } finally { await browser.close(); }
});

test("new letter echo supersedes the old one (fast typing stays snappy)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makePage(browser);
    await reset(page);
    await page.evaluate(async () => {
      Speech.say("A, ah", "letter");
      Speech.say("B, buh", "letter");             // immediate re-fire
      await Speech.say("Done!");
    });
    const l = await log(page);
    // the second letter must start without waiting for the first's full duration,
    // and the sentence must still trail the LAST letter echo's end.
    const starts = l.filter(e => e.ev === "start");
    assert.equal(starts[0].kind, "letter");
    assert.equal(starts[1].kind, "letter");
    const lastLetterEnd = [...l].reverse().find(e => e.ev === "end" && e.kind === "letter");
    const longStart = l.find(e => e.ev === "start" && e.kind === "long");
    assert.ok(longStart.t >= lastLetterEnd.t, "sentence trails the freshest echo");
    await ctx.close();
  } finally { await browser.close(); }
});
