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

// door rule (§C "Hold — nav DOOR"): max(contentMs + 400, 1600).
export function holdForDoor(contentMs) {
  return Math.max(contentMs + 400, 1600);
}

// The hold ladder, ascending by consequence (§A #2 / §C).
const HOLDS = {
  supportRead: 1000, // §C support-read (look=hear, not a commit; reader.js:63)
  content:     1200, // §C content tile default (board-render DWELL_DEFAULT; dwell.js:46)
  navBonus:     400, // §C door bonus added to content hold (board-render DWELL_NAV_BONUS)
  navMin:      1600, // §C nav-DOOR floor (board-render DWELL_NAV_MIN)
  answer:      1600, // §C answer / word / Speak (board-render DWELL_SPEAK)
  backspace:   1800, // §C backspace (studio.js:122)
  clear:       2000, // §C clear-all / prediction (board-render DWELL_CLEAR)
  send:        2200, // §C send / publish (27P #2)
  exit:        2400, // §C exit door / round-trip (27P #2; plan §4.1)
  floor:        800, // §C committing-action hold floor (apps clamp 800-3000)
  tuneMax:     3000, // §C tune-clamp ceiling (studio.js:1083)
  boardRuntimeMin: 600, // §E-6 board renderer /settings clamp floor (exception to 800)
  holdForDoor, // the door rule as a function, per §C
};

// Raw contract object (frozen below).
const _CONTRACT = {
  // ---- §C sizes (px) ----
  sizes: {
    fontFloor: 74,        // §C text-tile target floor (=32pt @166ppi; board-render.js:20)
    fontMin: 44,          // §C absolute min, fit-impossible only (board-render.js:21)
    fontCap: 112,         // §C upper clamp (board-render.js:22)
    gapFloor: 28,         // §C grid gap floor; pixel gate warns <34 (board-render.js:19)
    gapWarn: 34,          // §F pixel-gate warn threshold
    sidePadBoard: 40,     // §C board renderer side pad, <=48 (board-render.js:17)
    sidePadMakingWords: 60, // §C Making Words tray side pad (studio.js:256)
    vPad: 20,             // §C board vertical pad (board-render.js:18)
    barH: 140,            // §C reserved message-bar height, zero shift (board-render.js:16)
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
    holdMs: 2000,              // = holds.clear (reading must not become selecting)
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

// holdFor(type): hold ms for a named tile role (door needs contentMs -> holdForDoor).
const HOLD_BY_TYPE = {
  supportRead: HOLDS.supportRead, content: HOLDS.content, answer: HOLDS.answer,
  word: HOLDS.answer, speak: HOLDS.answer, backspace: HOLDS.backspace,
  clear: HOLDS.clear, prediction: HOLDS.clear, send: HOLDS.send, exit: HOLDS.exit,
};
export function holdFor(type) {
  const ms = HOLD_BY_TYPE[type];
  return ms == null ? HOLDS.content : ms; // unknown role falls back to content hold
}

// assertContract(el): Phase 2.3 will assert DOM invariants (target size, gap,
// font floor, park inert...) against CONTRACT. Placeholder no-op for now.
export function assertContract(el) { return el; }
