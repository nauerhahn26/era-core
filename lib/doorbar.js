/*
 * doorbar.js — the shared message bar for ALL FIVE of Ellie's apps.
 *
 * Moved out of era-board's board-render.js (mountDoorBar, :125-167) on 9/17 so
 * the Board, the Book Reader, Making Words and the Pencil wear ONE bar: same
 * strip, same corner, same holds, one place to change it. Styles live beside it
 * in doorbar.css (linked by each app's page).
 *
 * The bar is a SLIM strip (<=9% of the viewport, capped at the contract's
 * reserved barH) carrying TWO doors and nothing else that she can look at:
 *
 *   🚪 top-left    LEAVE — the round trip dad asked for 8/5 (D47). onLeave()
 *                  (stop speech/music), then POST /kiosk/exit: the hub decides
 *                  where the door goes (Settings, dad 9/3: TD Snap or Our Era Comms)
 *                  and does the engine hand-off + kiosk close itself. "closed"
 *                  = the screen is being handed over, so stay put; anything
 *                  else (or no hub at all) = the hub's home.
 *
 *   💬 top-centre  PAUSE TO TALK (dad 9/17) — she is mid-song or mid-book and
 *                  wants to SAY something. onPause() (the app pauses in place,
 *                  keeping its position), then POST /kiosk/pause {path}; the
 *                  hub parks the engine, minimizes this kiosk and brings TD
 *                  Snap forward, and answers {action:"paused"} — so the page
 *                  does nothing more, it is about to go under her. On ANYTHING
 *                  else — {action:"home"} (no gaze engine answered, so there is
 *                  nothing to bring forward), a non-2xx, or no hub at all — it
 *                  falls through to the 🚪 path. She must never be left silent
 *                  AND on screen.
 *                  When TD Snap hands the screen back (the launcher's
 *                  /kiosk/resume line re-foregrounds this kiosk), the page gets
 *                  a visibilitychange -> "visible": gaze arming is suppressed
 *                  for 600ms so her resting gaze cannot instantly fire a door,
 *                  then onResume() picks the app up where it stopped.
 *                  💬 only exists where there is something to talk TO: it stays
 *                  hidden until the app's /settings says pauseGoes:"tdsnap"
 *                  and calls setPause(true). On the QA VM and in a dev browser
 *                  the bar looks exactly as it did before 9/17.
 *
 * HOLDS (dad's 9/17 ruling, spec §5.1): both doors hold 2 x her Settings dwell
 * — they are the only two targets that take her off the screen. Everything else
 * in every app holds exactly her dwell. No floors, no bonuses, no fixed
 * numbers: holdForExit() in contract.js is the whole rule. The bar starts at the
 * contract's default dwell and the app calls setDwell() once /settings lands.
 *
 * BOARD LAW (amended 9/17): the message bar carries the two doors and nothing
 * else; they are its only dwell targets. The 9/4 partner-strip amendment stands
 * — a touch-only strip may sit at the bar's right end (it is never .dwell), and
 * it is why the 💬 is absolutely CENTRED on the bar rather than packed after
 * the 🚪: her motor plan for it must not move when a board grows a strip.
 *
 * Plain ES module, no build step. Apps load it as ../lib/doorbar.js.
 */

import { CONTRACT, holdForExit } from "./contract.js";

// dad 9/2 ("the header is still too big"): the bar is a SLIM strip like the one
// on Ellie's tablet — at most 9% of the viewport height, so it costs ~97px on
// the i13 at scale 1, ~65px at 150% scaling, instead of a flat 124. The
// contract's barH stays the ceiling for very tall panels. (Lifted with its
// reasoning from board-render.js CONFIG.BAR_H_FRAC.)
const BAR_H_FRAC = 0.09;

// Slim message bar: a fraction of the viewport, capped by the contract's
// reserved height. Recomputed on every sizeBar(), so a resize (or the jump from
// the 1024x768 QA VM to the i13) keeps the same 9% strip.
export function barHeight(vh) {
  return Math.min(CONTRACT.sizes.barH, Math.round(vh * BAR_H_FRAC));
}

// mountDoorBar(mount, opts) -> { bar, doorBtn, talkBtn, sizeBar, setPause,
//                                setDwell, destroy }
//   mount     element the bar is appended to; also carries --bar-h, which the
//             apps' own chrome offsets itself by (top: var(--bar-h)).
//   appPath   the path the hub matches the launcher's request against on
//             resume. Defaults to this page's path + query, read at click time.
//             PATH + QUERY ONLY, never location.hash: the hub normalises case
//             and a trailing slash and NOTHING else, so a fragment the launcher
//             does not carry would miss the match and she would get a fresh
//             kiosk instead of the song she paused.
//   onLeave   before the 🚪 exit (stop speech/music). Also runs on the 💬's
//             fall-through, because that leg IS the 🚪.
//   onPause   before the 💬 pause: pause in place, keep the position.
//   onResume  when the screen comes back after a pause.
//   exitTo    where a door goes when the hub did not close the kiosk ("/home/").
export function mountDoorBar(mount, opts = {}) {
  const { appPath, onLeave, onPause, onResume, exitTo = "/home/" } = opts;

  // her dwell, until the app's /settings lands and calls setDwell()
  let dwellMs = CONTRACT.holds.content;
  // set only by a hub that really paused this kiosk — the ONLY thing that makes
  // the next "visible" mean "she is back", rather than an alt-tab or a
  // screen-off. Lives on the bar, not on a global: two bars never race.
  let pausedFlag = false;

  const bar = document.createElement("div");
  bar.className = "msgbar";

  function door(id, extraClass, glyph, say, label) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bardoor" + (extraClass ? " " + extraClass : "") + " dwell";
    b.id = id;
    b.textContent = glyph;
    b.dataset.dwellSay = say;          // silent chrome; the name is for the gates
    b.setAttribute("aria-label", label);
    bar.appendChild(b);
    return b;
  }
  const doorBtn = door("barDoor", "", "🚪", "door", "door");
  const talkBtn = door("barTalk", "talk", "💬", "talk", "talk");
  talkBtn.hidden = true;               // until /settings says pauseGoes:"tdsnap"

  function applyHolds() {
    const ms = String(holdForExit(dwellMs));
    doorBtn.dataset.dwellMs = ms;
    talkBtn.dataset.dwellMs = ms;
  }
  applyHolds();
  mount.appendChild(bar);

  // ---- the round trip (era-board board-render.js:115-124, verbatim) ----
  // The kiosk origin ($ServerUrl/<app>/) is pre-allowed for 127.0.0.1 calls by
  // the installer's Chrome LNA policies (windows-device.ps1 step 2b) — no
  // Allow prompt.
  function exitToTDSnap() {
    fetch("/kiosk/exit", { method: "POST" })
      .then((r) => r.json())
      .then((j) => { if (j.action !== "closed") location.href = exitTo; })
      .catch(() => { location.href = exitTo; });   // no hub answer: back to the hub
  }
  function leave() {
    if (onLeave) onLeave();
    exitToTDSnap();
  }
  doorBtn.addEventListener("click", leave);

  talkBtn.addEventListener("click", () => {
    if (onPause) onPause();
    const path = appPath || (location.pathname + location.search);
    fetch("/kiosk/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.action === "paused") pausedFlag = true;  // she is going under; do nothing else
        else leave();                                       // "home", 4xx, garbage: be the 🚪
      })
      .catch(() => leave());                                // no hub at all: be the 🚪
  });

  // ---- coming back ----
  function onVisibility() {
    if (document.visibilityState !== "visible") return;
    if (!pausedFlag) return;                 // an alt-tab, not her coming back
    // PAGE-SETTLE (dwell.js 27P #5b): her gaze is already resting somewhere on
    // the screen that just reappeared. Block arming long enough that landing on
    // the app cannot itself select anything — the same reflex a re-rendered
    // page gets. Guarded: Making Words' and the Pencil's pages load the engine,
    // a bare fixture may not.
    const D = typeof window !== "undefined" ? window.Dwell : null;
    if (D && typeof D.suppress === "function") D.suppress(600);
    // spent BEFORE the app hook runs: a throwing onResume() must not leave the
    // bar armed to fire again on the next alt-tab
    pausedFlag = false;
    if (onResume) onResume();
  }
  document.addEventListener("visibilitychange", onVisibility);

  // Size the strip and the doors together. Each door fills the bar's content
  // height and is twice as wide as tall — deliberately smaller than the old
  // 150x96 slab (dad 9/2: "the icon for the exit can be smaller"), which is the
  // apps' one sanctioned exception to the >=90px dwell-target law: a top corner
  // is the easiest place on the screen to hit.
  function sizeBar() {
    const bh = barHeight(window.innerHeight);
    bar.style.height = bh + "px";
    // padding/border live in doorbar.css — read them back rather than restate them
    const cs = getComputedStyle(bar);
    const px = (v) => parseFloat(v) || 0;
    const inner = Math.max(24, bh - px(cs.paddingTop) - px(cs.paddingBottom)
                              - px(cs.borderTopWidth) - px(cs.borderBottomWidth));
    for (const b of [doorBtn, talkBtn]) {
      b.style.width = Math.round(2 * inner) + "px";
      b.style.fontSize = Math.round(inner * 0.62) + "px";
    }
    // the 💬 is out of the flex flow (absolutely centred), so it needs the
    // height and top the flex row gives the 🚪 for free
    talkBtn.style.height = Math.round(inner) + "px";
    // padding only: an absolute child is offset from the PADDING box, which
    // already sits inside the border — adding the border again would push it down
    talkBtn.style.top = Math.round(px(cs.paddingTop)) + "px";
    // the bar's usable height, published for anything else the bar carries —
    // today the pointer-only partner strip (board-partner.js), which must track
    // the strip exactly like the doors do instead of restating 9%.
    bar.style.setProperty("--bar-inner", Math.round(inner) + "px");
    // ...and the strip's full height, published on the MOUNT so each app's own
    // chrome (the Reader's screens, Making Words' stage, the Pencil's page) can
    // sit under the bar with `top: var(--bar-h)` and never overlap it.
    mount.style.setProperty("--bar-h", bh + "px");
    return bh;
  }
  sizeBar();

  // /settings landed: her real dwell, doubled onto both doors.
  function setDwell(ms) {
    if (Number.isFinite(ms) && ms > 0) { dwellMs = ms; applyHolds(); }
  }
  // /settings landed: is there a gaze engine + TD Snap to go and talk in?
  function setPause(on) {
    talkBtn.hidden = !on;
    // no 💬 means no pause is pending: the flag and the door's visibility are
    // the same fact, so a bar that loses the door cannot resume into TD Snap.
    if (!on) pausedFlag = false;
    // /settings can land a long way after mount (the board's splash bar is up
    // before the fetch returns) — re-size so a 💬 appearing after a resize is
    // never the size the screen used to be.
    if (on) sizeBar();
  }
  function destroy() {
    document.removeEventListener("visibilitychange", onVisibility);
    bar.remove();
  }

  return { bar, doorBtn, talkBtn, sizeBar, setPause, setDwell, destroy };
}
