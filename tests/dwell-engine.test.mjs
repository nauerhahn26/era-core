// dwell.js ENGINE suite (phase 2.2) — first isolated tests for the shared
// hover-to-activate engine. A synthetic DOM is route-served on the live origin
// (:8377) so the page loads the REAL /dwell.js from the server; only the fixture
// URL is intercepted. Times are scaled SHORT via window.DwellConfig (set before
// dwell.js loads) so the whole suite runs in a few seconds.
//
// The gaze bus is disabled (bus:"off") so activation is driven purely by
// synthetic pointer input — busConnected stays false, so track-loss gating never
// engages and the dwell clock runs on the rAF loop exactly as in production.
//
// DRIVING MODEL: a real eye tracker emits a CONTINUOUS sample stream while she
// looks at a target. We mirror that with hover(), which streams ~1px-jitter
// mousemoves for a duration. This is faithful to gaze input AND deterministic:
// under `node --test`, headless Chromium stalls a lone self-rescheduling rAF
// during a passive waitForTimeout, so a hold driven by a single mousemove + a
// bare wait does NOT reliably accumulate. Continuous input pumps frames.
//
// Config baked into the fixture:
//   ms:300 (default) graceMs:250 decayMs:300 padPx:20 rearmPx:48
// Per-target holds via data-dwell-ms. Activations recorded (with timestamps)
// into window.__acts by a capture-phase dwell:activate listener.
//
// Runs under `node --test` or `node tests/dwell-engine.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const FIXTURE_URL = "http://localhost:8377/__dwell_fixture__";
const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{margin:0;background:#111}
  /* NB: dwell.js injects a .dwell position:relative rule after this stylesheet
     and would win at equal specificity, so each target sets position:absolute
     INLINE (inline beats a stylesheet rule) to keep the fixed test geometry.
     Absolute still forms the containing block dwell.js's inset:0 fx needs. */
  .dwell{width:140px;height:140px;background:#2a6;color:#fff;
         display:flex;align-items:center;justify-content:center;font-size:40px}
</style>
<script>
  window.DwellConfig = { ms:300, graceMs:250, decayMs:300, padPx:20, rearmPx:48,
    audioPreview:false, chime:false, bus:"off" };
  window.__acts = [];               // activation timestamps (performance.now)
  document.addEventListener("dwell:activate",
    function(){ window.__acts.push(performance.now()); }, true);
</script>
</head><body>
  <div class="dwell" id="t-once"   data-dwell-noclick data-dwell-ms="300" style="position:absolute;left:700px;top:100px">once</div>
  <div class="dwell" id="t-300"    data-dwell-noclick data-dwell-ms="300" style="position:absolute;left:100px;top:100px">300</div>
  <div class="dwell" id="t-900"    data-dwell-noclick data-dwell-ms="900" style="position:absolute;left:100px;top:300px">900</div>
  <div class="dwell" id="t-resume" data-dwell-noclick data-dwell-ms="400" style="position:absolute;left:400px;top:100px">res</div>
  <div class="dwell" id="t-rearm"  data-dwell-noclick data-dwell-ms="250" style="position:absolute;left:400px;top:300px">arm</div>
  <div class="dwell" id="t-halo"   data-dwell-noclick data-dwell-ms="400" style="position:absolute;left:700px;top:300px">halo</div>
  <script src="/dwell.js"></script>
</body></html>`;

const GAP = { x: 960, y: 700 };   // empty point outside every target + its halo

async function makeDwellPage(browser, opts) {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    hasTouch: !!(opts && opts.touch),
  });
  await ctx.route("**/__dwell_fixture__", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML }));
  const page = await ctx.newPage();
  await page.goto(FIXTURE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.Dwell && typeof window.Dwell.state === "function");
  return { ctx, page };
}

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
           cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, sel);
const acts = (page) => page.evaluate(() => window.__acts.slice());
const mark = (page, name) => page.evaluate((n) => { window[n] = performance.now(); }, name);

// Stream ~1px-jitter mousemoves over (x,y) for `ms` — the continuous gaze
// sample stream. Jitter stays well inside rearmPx so it never re-arms a fire.
async function hover(page, x, y, ms) {
  const end = Date.now() + ms;
  let i = 0;
  while (Date.now() < end) {
    await page.mouse.move(x + (i & 1 ? 1 : 0), y + (i & 1 ? 0 : 1));
    i++;
    await page.waitForTimeout(16);
  }
}

// (a) Hovering a target for its hold fires dwell:activate exactly once (and,
//     thanks to the reactivation anchor, continued hovering does NOT re-fire).
test("hovering for data-dwell-ms fires dwell:activate exactly once", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-once");     // ms = 300
    await hover(page, r.cx, r.cy, 300 + 350);    // hold + keep looking
    assert.equal((await acts(page)).length, 1, "one sustained look -> exactly one activation");
    await ctx.close();
  } finally { await browser.close(); }
});

// (b) A sub-hold glance then leaving never activates (grace + decay expire and
//     progress can never reach the hold).
test("sub-hold glance then leave -> no activation after grace+decay", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-300");      // ms = 300
    await hover(page, r.cx, r.cy, 150);          // well under the hold
    await page.mouse.move(GAP.x, GAP.y);         // leave the target + its halo
    await page.waitForTimeout(250 + 300 + 200);  // grace + decay + slack
    assert.equal((await acts(page)).length, 0, "a 150ms glance must not activate");
    await ctx.close();
  } finally { await browser.close(); }
});

// (c) Look-away WITHIN graceMs then return: progress is frozen (not reset), so
//     activation comes EARLIER than a fresh start would. We assert total wall
//     time from first-hover to activation is < ms + grace + slack — a hard reset
//     (fresh ms after return) could not satisfy this given the away gap.
test("look-away within grace then return resumes progress (fires earlier than a fresh start)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-resume");   // ms = 400
    await mark(page, "__t0");
    await hover(page, r.cx, r.cy, 250);          // progress ~250 (< 400)
    await page.mouse.move(GAP.x, GAP.y);         // away
    await page.waitForTimeout(150);              // 150 < grace(250) -> frozen, no decay
    await hover(page, r.cx, r.cy, 350);          // resume from ~250 -> fires
    const a = await acts(page);
    assert.equal(a.length, 1, "resumes and fires exactly once");
    const total = await page.evaluate(() => window.__acts[0] - window.__t0);
    // resume ~= ms + away (400 + 150 = 550). A fresh restart would be
    // hover(250) + away(150) + ms(400) = 800. The bound sits between them.
    assert.ok(total < 400 + 250 + 100, `fired earlier than a fresh start (total ${total.toFixed(0)}ms)`);
    assert.ok(total >= 350, `did not fire prematurely (total ${total.toFixed(0)}ms)`);
    await ctx.close();
  } finally { await browser.close(); }
});

// (d) Reactivation anchor: after firing, re-activation requires moving beyond
//     rearmPx from the fire point. Continued jitter within the anchor does NOT
//     re-fire; moving far away then back does.
test("rearm anchor: jitter within rearmPx no re-fire; leave beyond it then return re-fires", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-rearm");    // ms = 250, rearmPx = 48
    await hover(page, r.cx, r.cy, 250 + 250);    // first activation
    assert.equal((await acts(page)).length, 1, "fires once");

    // keep hovering in place (jitter << rearmPx): gated, must NOT re-fire
    await hover(page, r.cx, r.cy, 350);
    assert.equal((await acts(page)).length, 1, "jitter within rearmPx does not re-fire");

    // leave far (clears the anchor over an empty gap), then return -> re-fires
    await page.mouse.move(GAP.x, GAP.y);
    await hover(page, r.cx, r.cy, 250 + 250);
    assert.equal((await acts(page)).length, 2, "leaving beyond rearmPx then returning re-fires");
    await ctx.close();
  } finally { await browser.close(); }
});

// (e) Per-target hold override honored: two targets with different data-dwell-ms
//     fire at their own holds (300 vs 900).
test("per-target data-dwell-ms honored (300ms vs 900ms targets)", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r3 = await rectOf(page, "#t-300");
    const r9 = await rectOf(page, "#t-900");

    await mark(page, "__t0");
    await hover(page, r3.cx, r3.cy, 300 + 300);
    assert.equal((await acts(page)).length, 1, "300ms target fired");

    await mark(page, "__t1");
    await hover(page, r9.cx, r9.cy, 900 + 300);  // 200px away -> clears anchor, begins fresh
    assert.equal((await acts(page)).length, 2, "900ms target fired");

    const dt300 = await page.evaluate(() => window.__acts[0] - window.__t0);
    const dt900 = await page.evaluate(() => window.__acts[1] - window.__t1);
    assert.ok(dt300 >= 250 && dt300 < 650, `300ms hold (~${dt300.toFixed(0)}ms)`);
    assert.ok(dt900 >= 820 && dt900 < 1400, `900ms hold (~${dt900.toFixed(0)}ms)`);
    assert.ok(dt900 > dt300 + 300, "the 900ms target clearly takes longer than the 300ms one");
    await ctx.close();
  } finally { await browser.close(); }
});

// (f) padPx halo: exiting the target by less than padPx keeps progress alive, so
//     the hold still completes without ever re-entering the element. (If the
//     halo failed, exiting would flip to away -> grace/decay -> no activation.)
test("padPx halo: exit by less than padPx keeps progress alive to activation", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-halo");     // ms = 400, padPx = 20
    await hover(page, r.cx, r.cy, 200);          // progress ~200 (< 400)
    await hover(page, r.right + 8, r.cy, 450);   // 8px outside edge -> inside 20px halo
    assert.equal((await acts(page)).length, 1, "staying within the halo completes the hold");
    await ctx.close();
  } finally { await browser.close(); }
});

// ---- TAP-PARITY LAW (7/27, dad): a physical tap acts exactly once ----------
// The tap's own click is the action. The synthesized mousemove that follows a
// tap parks the pointer on the target; without the pointerdown rearm, dwell
// would fire the SAME target again ~holdMs later (the reported double-tap bug).

const clicksOf = (page, sel) => page.evaluate((s) => window.__clicks[s] || 0, sel);
const armClicks = (page, sel) => page.evaluate((s) => {
  window.__clicks = window.__clicks || {};
  document.querySelector(s).addEventListener("click", () => {
    window.__clicks[s] = (window.__clicks[s] || 0) + 1;
  });
}, sel);

// (g) one tap = one click, and NO dwell fire while the pointer rests there
test("tap-parity: a real tap clicks once and dwell never double-fires it", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser, { touch: true });
    await armClicks(page, "#t-300");
    const r = await rectOf(page, "#t-300");      // ms = 300
    await page.touchscreen.tap(r.cx, r.cy);
    await page.waitForTimeout(1200);             // > ms + grace + decay + slack
    assert.equal(await clicksOf(page, "#t-300"), 1, "exactly one click from the tap");
    assert.equal((await acts(page)).length, 0, "no dwell:activate after a tap (rearmed)");
    await ctx.close();
  } finally { await browser.close(); }
});

// (h) after a tap, dwell stays disarmed within rearmPx and re-arms beyond it
test("tap-parity: dwell re-arms only after leaving rearmPx, then works again", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser, { touch: true });
    const r = await rectOf(page, "#t-rearm");    // ms = 250, rearmPx = 48
    await page.touchscreen.tap(r.cx, r.cy);
    await hover(page, r.cx, r.cy, 600);          // jitter INSIDE rearmPx of the tap
    assert.equal((await acts(page)).length, 0, "hover near the tap point stays disarmed");
    await hover(page, GAP.x, GAP.y, 150);        // leave well beyond rearmPx
    await hover(page, r.cx, r.cy, 600);          // gaze returns -> dwell works again
    assert.equal((await acts(page)).length, 1, "dwell functions normally after re-arming");
    await ctx.close();
  } finally { await browser.close(); }
});

// (i) fx layer survives an innerHTML rewrite of a persistent target: the fill
//     must re-inject and visibly rise again (dad-reported 8/2 — the Pencil's
//     back/abcd seat rewrites its label each page flip; the cached fx nodes
//     were detached and the engine filled a ghost).
test("fill re-injects after a target's innerHTML is rewritten", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-rearm");            // 250ms target
    await hover(page, r.cx, r.cy, 120);                  // mid-fill: fx exists
    const before = await page.evaluate(() => {
      const el = document.querySelector("#t-rearm");
      return { has: !!el.querySelector(".dwell-fill"),
               h: parseFloat(el.querySelector(".dwell-fill").style.height) || 0 };
    });
    assert.ok(before.has && before.h > 0, "fill visible before rewrite");

    // the app rewrites the label (what the Pencil's seat does) — fx detaches
    await page.mouse.move(GAP.x, GAP.y);
    await page.evaluate(() => { document.querySelector("#t-rearm").innerHTML = "<span>back</span>"; });
    await page.waitForTimeout(1600);                     // grace+decay fully drain (no held progress
                                                         // racing the read below into a fire)
    await hover(page, r.cx, r.cy, 120);                  // return: must re-inject
    const after = await page.evaluate(() => {
      const el = document.querySelector("#t-rearm");
      const f = el.querySelector(".dwell-fill");
      return { connected: !!(f && f.isConnected),
               h: f ? parseFloat(f.style.height) || 0 : 0 };
    });
    assert.ok(after.connected, "fx layer re-injected after innerHTML rewrite");
    assert.ok(after.h > 0, "fill visibly rising again (was the ghost-node bug)");
    await ctx.close();
  } finally { await browser.close(); }
});

// (h) Page-settle suppression (27P #5b): Dwell.suppress() clears a mid-fill
//     dwell and blocks re-arming for the settle window even under continuous
//     hover (the "new page renders under her parked gaze" case). Once the
//     window expires, the SAME sustained hover starts a fresh hold and fires.
test("Dwell.suppress(ms) clears live dwell, blocks arming through the window, re-arms after", async () => {
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await makeDwellPage(browser);
    const r = await rectOf(page, "#t-300");            // ms = 300
    await hover(page, r.cx, r.cy, 150);                // mid-fill (< hold)

    await mark(page, "__ts");
    const st = await page.evaluate(() => { window.Dwell.suppress(600); return window.Dwell.state(); });
    assert.equal(st.target, null, "suppress() clears the live dwell");
    assert.ok(st.suppressedMs > 400, `settle window armed (${st.suppressedMs.toFixed(0)}ms left)`);

    await hover(page, r.cx, r.cy, 450);                // hover THROUGH the window
    assert.equal((await acts(page)).length, 0, "no activation while suppressed");

    await hover(page, r.cx, r.cy, 700);                // window over -> fresh hold fires
    const a = await acts(page);
    assert.equal(a.length, 1, "fires once after the settle window");
    const sinceSuppress = await page.evaluate(() => window.__acts[0] - window.__ts);
    assert.ok(sinceSuppress >= 600 + 250,
      `fire waited for window + a fresh hold (${sinceSuppress.toFixed(0)}ms >= 850)`);
    await ctx.close();
  } finally { await browser.close(); }
});
