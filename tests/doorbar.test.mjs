// doorbar.test.mjs — the SHARED message bar (lib/doorbar.js + lib/doorbar.css).
//
// The bar used to live in era-board's board-render.js and carried one door.
// Since dad's 9/17 "pause to talk" ruling it lives here and carries TWO:
//   🚪 top-left   — leave: onLeave() then POST /kiosk/exit (today's round trip)
//   💬 top centre — pause: onPause() then POST /kiosk/pause {path}; on
//                   {action:"paused"} the hub minimizes the kiosk under her and
//                   brings TD Snap forward, so the page does nothing more. On
//                   ANYTHING else (home, 4xx, no hub at all) it must fall
//                   through to the 🚪 path: she must never be left silent and
//                   still on screen.
// Both doors hold 2 x her dwell (contract.js holdForExit); everything else on
// every screen holds exactly her dwell.
//
// HOW TO RUN:  node --test tests/doorbar.test.mjs   (nothing else needed)
// The suite serves era-core itself on an OS-ASSIGNED free port (listen(0)) —
// never a fixed one: 8377/8378 are the family's live and gate hubs, the suite
// ports reach 8449 and the ssh device tunnels answer HTTP as a REAL device
// above 8500. Nothing here talks to a hub: the two POSTs are page.route()d, so
// the static server needs no API surface at all.
//
// visibilitychange: Chromium keeps a headless page "visible", and
// document.visibilityState is a prototype getter, so an own property defined on
// `document` shadows it — the fixture is driven by a real dispatched event with
// the state forced, exactly as the tablet will deliver it on restore. (Plan
// T4's STOP-if — an un-overridable visibilityState needing a
// __doorbarTest.simulateVisible() escape hatch — did NOT come up.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Two shapes to find lib/ in: this repo's own checkout (tests/ -> ..), and the
// parity gate, which flattens every repo's tests into era-hub/gate/ — from
// there era-core's files are reachable through era-hub's assembled public/
// (tools/assemble.sh symlinks public/lib -> era-core/lib). Same idiom as
// lib-contract.test.mjs and board-pixel.test.mjs:23.
const pick = (cands, probe) => cands.filter(Boolean).map((d) => path.resolve(d))
  .find((d) => fs.existsSync(path.join(d, probe))) || null;
const ROOT = pick([path.join(HERE, ".."), path.join(HERE, "..", "public")], "lib/doorbar.js");
if (!ROOT) throw new Error("lib/doorbar.js not found from " + HERE);

const { barHeight } = await import(new URL("file://" + path.join(ROOT, "lib/doorbar.js")));

// The fixture: an app shell with a mount, the bar's own stylesheet, and a
// 300px right-hand strip standing in for the board's partner strip (dad 9/4) —
// the one other thing allowed in the bar, and the thing the centre door must
// never overlap.
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/lib/doorbar.css">
<style>
  html,body{height:100%;margin:0;font-family:system-ui,sans-serif}
  #app{position:fixed;inset:0;display:flex;flex-direction:column}
  #grid{flex:1 1 auto;background:#F7F9F8}
  /* stand-in for board-partner.js's strip: right-anchored, 300px wide */
  #fakeStrip{position:absolute;right:12px;top:6px;height:var(--bar-inner,40px);
             width:300px;background:rgba(255,255,255,.16)}
</style></head><body>
<div id="app"><div id="grid"></div></div>
<script type="module">
  import { mountDoorBar } from "/lib/doorbar.js";
  window.__calls = [];
  // the shared dwell engine's page-settle hook, stubbed: the bar must call it
  // on resume so her gaze resting on the screen she comes back to cannot
  // instantly re-arm a door.
  window.Dwell = { suppress(ms) { window.__calls.push("suppress:" + ms); } };
  const opts = {
    appPath: "/board/?recipe=songs",
    onLeave: () => window.__calls.push("leave"),
    onPause: () => window.__calls.push("pause"),
    onResume: () => window.__calls.push("resume"),
  };
  // ?default=1 mounts with NO appPath, so the bar derives it from location
  if (new URLSearchParams(location.search).has("default")) delete opts.appPath;
  window.__bar = mountDoorBar(document.getElementById("app"), opts);
  const strip = document.createElement("div");
  strip.id = "fakeStrip";
  window.__bar.bar.appendChild(strip);
  window.__ready = true;
</script></body></html>`;

const MIME = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html" };

function fixtureServer() {
  const srv = http.createServer((req, res) => {
    const done = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain" }); res.end(body); };
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method !== "GET") { req.resume(); return done(404, "no api here"); }
    if (p === "/" || p === "/fixture.html") return done(200, FIXTURE, "text/html");
    // the door's fallback destination, so a real navigation lands somewhere
    if (p === "/home/" || p === "/home") return done(200, "<!doctype html><title>home</title>hub home", "text/html");
    const f = path.resolve(path.join(ROOT, p));
    if (f.startsWith(ROOT + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())
      return done(200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream");
    done(404, "not found");
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

let srv, browser, BASE;
before(async () => {
  srv = await fixtureServer();
  BASE = "http://127.0.0.1:" + srv.address().port;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  // a keep-alive socket from the fixture would hold close()'s callback forever
  srv.closeAllConnections();
  await new Promise((r) => srv.close(r));
});

async function open(size = { width: 1280, height: 720 }, url = "/") {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.__ready === true);
  return { ctx, page };
}
const calls = (page) => page.evaluate(() => window.__calls);
// force the page "visible" and deliver the event exactly as a restored kiosk does
const goVisible = (page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
});

// ---------------------------------------------------------------------------

test("the bar carries exactly two dwell targets: 🚪 left and 💬 centre", async () => {
  const { ctx, page } = await open();
  try {
    const shape = await page.evaluate(() => {
      const bar = document.querySelector(".msgbar");
      return {
        dwell: [...bar.querySelectorAll(".dwell")].map((e) => e.id),
        classes: [...bar.querySelectorAll(".dwell")].map((e) => e.className),
        glyphs: [...bar.querySelectorAll(".dwell")].map((e) => e.textContent),
        say: [...bar.querySelectorAll(".dwell")].map((e) => e.dataset.dwellSay),
        aria: [...bar.querySelectorAll(".dwell")].map((e) => e.getAttribute("aria-label")),
      };
    });
    assert.deepEqual(shape.dwell, ["barDoor", "barTalk"], "two doors, in DOM order");
    for (const c of shape.classes) assert.match(c, /\bbardoor\b.*\bdwell\b|\bdwell\b.*\bbardoor\b/);
    assert.deepEqual(shape.glyphs, ["🚪", "💬"]);
    assert.deepEqual(shape.say, ["door", "talk"], "both doors are SILENT chrome; the say name is for the gate");
    assert.deepEqual(shape.aria, ["door", "talk"], "spec §5 wording; master's board shipped aria-label=\"door\"");
  } finally { await ctx.close(); }
});

test("💬 is hidden until setPause(true) — a dev browser and the VM look exactly as today", async () => {
  const { ctx, page } = await open();
  try {
    const talk = page.locator("#barTalk");
    assert.equal(await talk.evaluate((e) => e.hidden), true, "hidden attribute set at mount");
    assert.equal(await talk.isVisible(), false, "and hidden means DRAWN nowhere: .bardoor[hidden] beats display:flex");
    assert.equal(await page.locator("#barDoor").isVisible(), true, "the 🚪 is there from the first paint (dad 9/3)");

    await page.evaluate(() => window.__bar.setPause(true));
    assert.equal(await talk.isVisible(), true, "/settings said pauseGoes:tdsnap — 💬 appears");
    await page.evaluate(() => window.__bar.setPause(false));
    assert.equal(await talk.isVisible(), false, "and goes away again if it ever flips back");
  } finally { await ctx.close(); }
});

test("both doors hold 2 x her dwell: 1200 default -> 2400, setDwell(900) -> 1800", async () => {
  const { ctx, page } = await open();
  try {
    const holds = () => page.evaluate(() =>
      [...document.querySelectorAll(".msgbar .dwell")].map((e) => e.dataset.dwellMs));
    assert.deepEqual(await holds(), ["2400", "2400"], "before /settings lands: the contract default dwell, doubled");
    await page.evaluate(() => window.__bar.setDwell(900));
    assert.deepEqual(await holds(), ["1800", "1800"], "her Settings dwell, doubled — no invented rung");
    await page.evaluate(() => window.__bar.setDwell(600));
    assert.deepEqual(await holds(), ["1200", "1200"]);
  } finally { await ctx.close(); }
});

test("💬 click: onPause() first, then POST /kiosk/pause with THIS app's path", async () => {
  const { ctx, page } = await open();
  try {
    let hits = 0, body = null, ct = null, exits = 0;
    await ctx.route("**/kiosk/pause", (r) => {
      hits++; body = r.request().postData(); ct = r.request().headers()["content-type"];
      r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"paused"}' });
    });
    await ctx.route("**/kiosk/exit", (r) => { exits++; r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"closed"}' }); });
    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForTimeout(250);
    assert.equal(hits, 1, "POSTed exactly once");
    assert.deepEqual(JSON.parse(body), { path: "/board/?recipe=songs" }, "the hub matches the launcher's path against this");
    assert.match(ct || "", /application\/json/);
    assert.equal(exits, 0, "paused: the kiosk is being minimized UNDER her — never also exited");
    assert.deepEqual(await calls(page), ["pause"], "the app stopped its speech/music before the screen went away");
    assert.match(page.url(), /127\.0\.0\.1/, "no navigation");
  } finally { await ctx.close(); }
});

// The hub normalises case and a trailing slash and NOTHING else before matching
// the launcher's path (T2). start-hub.bat sends what TD Snap's tile asks for —
// a path and a query, never a fragment — so a bar that posted location.hash
// would miss the match and she would get a fresh kiosk instead of her song.
test("with no appPath given: the bar posts pathname + search, NEVER the hash", async () => {
  const { ctx, page } = await open({ width: 1280, height: 720 }, "/?default=1#page3");
  try {
    let body = null;
    await ctx.route("**/kiosk/pause", (r) => {
      body = r.request().postData();
      r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"paused"}' });
    });
    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForTimeout(250);
    assert.deepEqual(JSON.parse(body), { path: "/?default=1" });
  } finally { await ctx.close(); }
});

test("visibilitychange -> onResume ONLY after a pause (and Dwell.suppress first)", async () => {
  const { ctx, page } = await open();
  try {
    await ctx.route("**/kiosk/pause", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"paused"}' }));

    // she never pressed 💬: a restore/alt-tab must change nothing
    await goVisible(page);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page), [], "no pause, no resume");

    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForTimeout(250);
    await goVisible(page);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page), ["pause", "suppress:600", "resume"],
      "back from TD Snap: gaze arming is suppressed BEFORE the app wakes up");

    // one restore per pause: a second visible with no new 💬 does nothing
    await goVisible(page);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page), ["pause", "suppress:600", "resume"], "the flag is cleared");
  } finally { await ctx.close(); }
});

test("a hub that answers {action:\"home\"} falls through to the 🚪 path", async () => {
  const { ctx, page } = await open();
  try {
    let exits = 0;
    await ctx.route("**/kiosk/pause", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"home"}' }));
    await ctx.route("**/kiosk/exit", (r) => { exits++; r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"closed"}' }); });
    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForTimeout(300);
    assert.equal(exits, 1, "no engine to pause into: the 💬 behaves as the 🚪");
    assert.deepEqual(await calls(page), ["pause", "leave"]);
    // and the pause flag was never set, so a later restore must not fire onResume
    await goVisible(page);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page), ["pause", "leave"]);
  } finally { await ctx.close(); }
});

test("no hub at all: 💬 still gets her off the screen (fetch fails -> 🚪 -> /home/)", async () => {
  const { ctx, page } = await open();
  try {
    await ctx.route("**/kiosk/pause", (r) => r.abort("connectionrefused"));
    await ctx.route("**/kiosk/exit", (r) => r.abort("connectionrefused"));
    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForURL(/\/home\/?$/, { timeout: 8000 });
  } finally { await ctx.close(); }
});

test("🚪 click: onLeave() then /kiosk/exit; anything but closed goes to the hub's home", async () => {
  const { ctx, page } = await open();
  try {
    let exits = 0;
    await ctx.route("**/kiosk/exit", (r) => { exits++; r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"home"}' }); });
    await page.locator("#barDoor").click();
    await page.waitForURL(/\/home\/?$/, { timeout: 8000 });
    assert.equal(exits, 1);
  } finally { await ctx.close(); }
});

test("1280x720: the centre door never touches the 300px right strip", async () => {
  const { ctx, page } = await open({ width: 1280, height: 720 });
  try {
    await page.evaluate(() => window.__bar.setPause(true));
    const m = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const el = document.querySelector(".msgbar");
      const bar = el.getBoundingClientRect();
      return { door: r("#barDoor"), talk: r("#barTalk"), strip: r("#fakeStrip"), bar: { w: bar.width, h: bar.height },
               // the two values sizeBar() PUBLISHES — everything outside the bar
               // sizes itself off these, so they are contract, not bookkeeping
               barInner: el.style.getPropertyValue("--bar-inner"),
               mountBarH: document.getElementById("app").style.getPropertyValue("--bar-h"),
               vh: window.innerHeight };
    });
    const clear = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5;
    assert.ok(clear(m.door, m.talk), `🚪 ${m.door.r.toFixed(0)} vs 💬 ${m.talk.l.toFixed(0)}`);
    assert.ok(clear(m.talk, m.strip), `💬 ${m.talk.r.toFixed(0)} vs strip ${m.strip.l.toFixed(0)}`);
    // and the centre door really is centred in the bar
    assert.ok(Math.abs((m.talk.l + m.talk.r) / 2 - m.bar.w / 2) < 1.5, "💬 is centred");
    // ... at the same size as the 🚪, filling the strip (the invariants' bar law)
    assert.ok(Math.abs(m.talk.h - m.door.h) < 0.5, "same height as the 🚪");
    assert.ok(Math.abs(m.talk.w - m.door.w) < 0.5, "same width as the 🚪");
    assert.ok(m.talk.w >= m.talk.h * 2 - 1.5, "at least twice as wide as tall (invariants law 1)");
    assert.equal(Math.round(m.bar.h), barHeight(720), "the bar is barHeight(vh) tall");

    // --- the two published contracts ---
    // 1) --bar-inner IS the door's rendered height: board-partner.js's touch-only
    //    strip (dad 9/4) sizes itself off it and must land level with the 🚪.
    assert.match(m.barInner, /^\d+px$/, "--bar-inner is published inline on the bar");
    assert.ok(Math.abs(parseFloat(m.barInner) - m.door.h) <= 1,
      `--bar-inner ${m.barInner} vs 🚪 rendered height ${m.door.h.toFixed(2)}px`);
    // 2) --bar-h on the MOUNT is the live strip height: the Reader's screens,
    //    Making Words' stage and the Pencil's page sit at top: var(--bar-h).
    assert.equal(m.mountBarH, barHeight(m.vh) + "px", "--bar-h on the mount = barHeight(innerHeight)");
    assert.equal(parseFloat(m.mountBarH), Math.round(m.bar.h), "...which is the strip actually drawn");
  } finally { await ctx.close(); }
});

test("destroy() takes the bar and its listener away", async () => {
  const { ctx, page } = await open();
  try {
    await ctx.route("**/kiosk/pause", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: '{"action":"paused"}' }));
    await page.evaluate(() => window.__bar.setPause(true));
    await page.locator("#barTalk").click();
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__bar.destroy());
    assert.equal(await page.locator(".msgbar").count(), 0);
    await goVisible(page);
    await page.waitForTimeout(100);
    assert.deepEqual(await calls(page), ["pause"], "a destroyed bar answers no more events");
  } finally { await ctx.close(); }
});

test("barHeight(vh): a slim strip, capped by the contract's reserved height", () => {
  assert.equal(barHeight(720), 65);    // her i13 at 150% scaling — 9%
  assert.equal(barHeight(1080), 97);   // scale 1
  assert.equal(barHeight(2000), 124);  // a tall panel: the contract's barH ceiling
  assert.equal(barHeight(768), 69);    // the QA VM
});
