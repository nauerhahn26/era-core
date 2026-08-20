/*
 * shell.js — app boilerplate factories, extracted FAITHFULLY from the 4 apps
 * (Making Words studio.js, The Pencil pencil.js, Board board.js, Reader
 * reader.js).  Plain ES module, no build step.  No app wiring — Phase 3
 * migrates apps onto these.  Each export cites the app(s) it came from.
 */
import { CONTRACT } from "./contract.js";

/*
 * makeLog(app, opts) — the /log JSONL envelope, superset of all 4 apps.
 * Extracted from pencil.js:120-122 and reader.js:15-17:
 *     { t, session, app, event, ...detail }  POSTed to /log, errors swallowed.
 * Making Words (studio.js:48-53) omits `app` but adds lesson/phase — those ride
 * as free `detail` fields in this superset, so all apps fit one envelope.
 * `session` mirrors the apps' `"<prefix>" + Date.now()` (studio "s", reader "r").
 */
export function makeLog(app, opts = {}) {
  const session = opts.session || (app && app[0] ? app[0] : "s") + Date.now();
  const endpoint = opts.endpoint || "/log";
  function log(event, detail) {
    const rec = { t: Date.now(), session, app, event, ...detail };
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec) }).catch(() => {});
    return rec;
  }
  log.session = session;
  return log;
}

/*
 * wireTtsWarn(speech, opts) — boot TTS self-test -> show the partner-only
 * #ttsWarn banner if voice is dead.  Extracted from board.js:127-134 (mode ===
 * "off" -> warn.classList.add("show")); studio.js:1170-1172 and pencil.js:427-429
 * express the same law as `!S.tts` where tts = mode !== "off".  Returns the mode
 * ("eleven" | "local" | "off") so callers can set their own S.tts.
 */
export async function wireTtsWarn(speech, opts = {}) {
  const sample = opts.sample || "Ready.";
  const warnId = opts.warnId || "ttsWarn";
  let mode = "off";
  try { mode = await speech.init(sample); } catch { mode = "off"; }
  if (mode === "off" && typeof document !== "undefined") {
    const w = document.getElementById(warnId);
    if (w) w.classList.add("show");
  }
  return mode;
}

/*
 * dwellConfigDefaults(overrides) — the window.DwellConfig apps set at boot,
 * sourced from CONTRACT.dwellEngine.  Matches studio/index.html:136-140,
 * pencil/index.html:114-117, board/index.html:14-18: engine tuning + chime OFF +
 * audioPreview OFF (§10) + gaze bus.  NOTE: the live app HTML currently ships
 * staleMs:600 — and CONTRACT now carries 600 (Gate-2 ruling: live apps win);
 * this returns 500 so Phase-3 migration converges the apps onto the contract.
 */
export function dwellConfigDefaults(overrides = {}) {
  const d = CONTRACT.dwellEngine;
  return {
    ms: d.ms, graceMs: d.graceMs, decayMs: d.decayMs, padPx: d.padPx, rearmPx: d.rearmPx,
    staleMs: d.staleMs, audioPreview: d.audioPreview, chime: d.chime,
    bus: "auto", color: "#0F7C8A", // §27 brand teal (dwell fill)
    ...overrides,
  };
}

/*
 * makeParkPad() — the inert black park pad element.  Extracted from
 * studio.js:126-129: caps the right end of a full-bleed row; NOT `.dwell`, so the
 * ERAgaze-parked cursor (bottom-right, on track loss) can never activate it.
 * Width is themed by the app (studio uses --parkW); returns just the element.
 */
export function makeParkPad() {
  if (typeof document === "undefined") return null;
  const pad = document.createElement("div");
  pad.id = "parkPad";
  pad.setAttribute("aria-hidden", "true");
  return pad;
}
