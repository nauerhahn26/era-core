/*
 * contract.js — the machine-readable UX contract for Ellie's eye-gaze apps.
 * Plain ES module, no build step, no DOM (safe to import in node + browser).
 *
 * SPEC: mirrors /home/claude/aac-board-builder/knowledge/ux-contract.md 1:1
 * (doc = WHY, this file = VALUES).  Change the DOC first, then this file.
 * Whitelist principle (plan §2.1): if a size/hold/placement is not here, agents
 * do NOT invent it.  Every value carries a one-line cite to a ux-contract §.
 * Not yet imported by any app — Phase 3 migrates apps onto it.
 */

// Exit rule (§C "Hold — doors that leave the screen", dad 9/17): the two doors
// that take her off the screen — 🚪 exit and 💬 talk — hold TWICE her dwell.
// Everything else holds her dwell exactly. There is no third speed.
export function holdForExit(contentMs) {
  return 2 * contentMs;
}

// The holds (§A #2 / §C). AMENDED 9/17: the invented content < nav < answer <
// backspace < clear < send < exit ladder is gone — the field ships ONE dwell per
// user, and only leaving the screen buys extra time. `navBonus`, `navMin`,
// `answer`, `backspace`, `clear`, `send`, `exit` and `holdForDoor` were REMOVED,
// not deprecated: the whitelist principle cuts both ways, and a rung nobody may
// use must not exist to be reached for.
const HOLDS = {
  supportRead: 1000, // §C reading target: look=hear, under dwell so it never commits (reader.js:63)
  content:     1200, // §C the Settings default dwell — every control's hold (dwell.js:46)
  floor:        800, // §C committing-action hold floor (partner tune clamps 800-3000)
  tuneMax:     3000, // §C tune-clamp ceiling (studio.js:1297, pencil.js:497)
  boardRuntimeMin: 600, // §E-6 board renderer /settings clamp floor (exception to 800)
  holdForExit, // §C the exit rule as a function (2 x dwell), dad 9/17
};

// Raw contract object (frozen below).
const _CONTRACT = {
  // ---- §C sizes (px) ----
  sizes: {
    fontFloor: 74,        // §C text-tile target floor (=32pt @166ppi; board-render.js:20)
    fontMin: 44,          // §C absolute min, fit-impossible only (board-render.js:21)
    fontCap: 112,         // §C upper clamp (board-render.js:22)
    gapFloor: 14,         // §C grid gap floor (board-render.js:19). AMENDED 9/5: Ellie's own
                          // tablet packs its tiles at ~1% of screen width (~14px at 1920) and
                          // dad wants that back — "you put too much spacing between the tiles
                          // in the new build ... it allows each tile to be larger". Her proven
                          // device outranks the invented mishit-resistance floor (§24).
    gapWarn: 14,          // §F pixel-gate warn threshold — RETIRED, pinned to gapFloor. The
                          // board draws exactly the floor, so any warn above it would fire on
                          // every tile pair on every page and mean nothing.
    sidePadBoard: 28,     // §C board renderer side pad (board-render.js:17); measured off her
                          // tablet's photo (dad 9/5), was 40
    sidePadMakingWords: 60, // §C Making Words tray side pad (studio.js:256)
    vPad: 12,             // §C board vertical pad (board-render.js:18); her tablet's top/bottom
                          // pad (dad 9/5), was 20
    barH: 124,             // §C reserved message-bar height, zero shift (board-render.js:16).
                          // 140 ate the grid on a 13" 1920x1080 (dad 9/1: "the header is
                          // too large"); her tablet's bar is a slim strip.
    gapFrac: 0.22,        // §C Making Words gap fraction (studio.js:256)
    trayBand: 0.30,       // §C full-bleed row band = 0.30 viewport H (studio.js:271)
    parkUnits: 0.55,      // §C park-pad width in tray units (studio.js:271)
    photoLabelShare: 0.20,// §C photo tile: label <=1/5, photo >=4/5 (board-render.js:27)
    photoPlateMin: 52,    // §C photo label plate min px (board-render.js:29)
    photoFontCap: 46,     // §C (board-render.js:28)
    photoFontMin: 24,     // §C (board-render.js:28)
  },

  // ---- §A #2 / §D holds (ms) ----
  holds: HOLDS,

  // ---- §21 choices ----
  maxChoices: {
    ideal: 2,       // §21 "pick the minimum the activity needs"; 2-4 real decisions
    comfortable: 12,// §21 comfortable ceiling
    cap: 16,        // §21 absolute cap
  },

  // ---- §B park corner (the literal screen corner; ERAgaze parks here) ----
  parkCorner: { x01: 0.995, y01: 0.995, inert: true }, // §B ParkX01/ParkY01; never a target
  // §B per-app override (8/1): POST /app/park {x,y} — transient, cleared by /app/exit.
  parkOverride: { endpoint: "http://127.0.0.1:49155/app/park", persisted: false },

  // ---- §A prediction laws (8/1) ----
  prediction: {
    slots: 3,                  // fixed, always reserved (zero layout shift)
    singlePaintMs: 250,        // rested -> filled at most once; never swaps mid-dwell
    midWordLead: "local-phonetic", // invented-spelling support outranks literal server
    nextWordLead: "server",    // only the server has sentence context
    holdMs: 2000,              // §C reading target: held ABOVE dwell so reading the three
                               // suggestions cannot become selecting one (untouched 9/17)
  },

  // ---- §B nav / motor-plan anchors (dad's law 7/24-26; frozen forever) ----
  navAnchors: {
    more: "bottom-left",   // §B dad's law, TD-Snap-consistent
    exit: "bottom-right",  // §B Build/Exit round-trip door (grid `type:"exit"` TILES only;
                           //    literacy-app doors stay TOP-LEFT — dad ruling 7/28, §B header)
    boardDoor: "top-left", // §B Ellie Board's fixed msgbar 🚪 (dad 8/5, D47; supersedes
                           //    D45 "none" — bar chrome, costs no grid seat)
    back: "top-left",      // §B (grouped with weather)
    restCells: "center",   // §B two center rest cells on 4x3 boards
  },

  // ---- §A dwell engine defaults (dwell.js:46-48) ----
  dwellEngine: {
    ms: 1200,      // §C default hold (dwell.js:46)
    graceMs: 400,  // §C look-away grace (dwell.js:46; §E-4 beats old 300)
    decayMs: 1000, // §C full->empty decay (dwell.js:46; §E-1 beats jsdoc 900)
    padPx: 16,     // §C hysteresis halo (dwell.js:47; §E-2 beats jsdoc 12)
    rearmPx: 48,   // §C reactivation anchor (dwell.js:47; §E-3 beats 40)
    staleMs: 600,  // §C track-loss freeze. GATE-2 RULING (7/27): all three live apps
                   // ship 600 in DwellConfig — live code wins; dwell.js's 500 default
                   // was drift nobody ran. Engine default aligns in Phase 3.
    settleMs: 250, // §C 27P #5b page-settle: a re-rendered surface suppresses dwell
                   // arming this long so a fresh page never inherits her gaze
                   // (8/16; = TD Snap "Delay After Page Change" on the gaze device)
    chime: false,        // §10 apps force OFF (engine default true) — beeps read electronic
    audioPreview: false, // §10 apps force OFF — would cancel() coaching speech
    gazeBus: "ws://127.0.0.1:49155", // §C authoritative bus (dwell.js:253; §E-8)
  },

  // ---- §B/§C speech laws ----
  speech: {
    bargeIn: "stop-before-say", // §12 Speech.stop() at start of EVERY user action
    serialization: "sentence-waits-for-letter-echo", // §12 letter echo plays now; sentence waits
  },

  // ---- §D devices — both must pass (native resolution WxH) ----
  devices: [
    { w: 1920, h: 1080 }, // Tobii TD I-13 (primary gaze device; 166ppi)
    { w: 2736, h: 1824 }, // companion tablet-class display
  ],
  // §D/§F the pixel gate additionally renders at these viewports per state:
  gateViewports: [ { w: 1920, h: 1080 }, { w: 1280, h: 720 } ],
};

// deep-freeze so the whitelist cannot be mutated at runtime.
function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") deepFreeze(v);
  }
  return Object.freeze(o);
}

export const CONTRACT = deepFreeze(_CONTRACT);

// ---- tiny helpers used verbatim by future migrations ----

// holdFor(role, dwell): hold ms for a named target role at HER dwell (dad 9/17).
// Two speeds and two reading targets, nothing else:
//   exit / talk  -> 2 x dwell   (🚪 / 💬 — the two doors that leave the screen;
//                                dad 9/17 named both, so both roles are accepted)
//   supportRead  -> 1000        (a glance reads a word aloud; under dwell, never commits)
//   prediction   -> 2000        (held above dwell so reading three cannot pick one)
//   anything else-> dwell       (content, nav doors, Speak, clear, backspace, send,
//                                reader tiles, Pencil + Making Words controls)
// A missing / non-numeric dwell falls back to the contract default (1200).
export function holdFor(role, dwell) {
  const ms = Number.isFinite(dwell) ? dwell : HOLDS.content;
  if (role === "exit" || role === "talk") return holdForExit(ms);
  if (role === "supportRead") return HOLDS.supportRead;
  if (role === "prediction") return CONTRACT.prediction.holdMs;
  return ms;
}

// assertContract(el): Phase 2.3 will assert DOM invariants (target size, gap,
// font floor, park inert...) against CONTRACT. Placeholder no-op for now.
export function assertContract(el) { return el; }
