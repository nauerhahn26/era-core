/*
 * dwell.js v2 — hover-to-activate for eye-gaze web apps, tuned for Rett syndrome.
 *
 * The gaze layer (RaeGaze) only moves the cursor and shows where she's looking.
 * ACTIVATION lives here, per element, so nothing fires just because her gaze
 * passes over it — only elements that opt in, each with its own hold time.
 *
 *   <script src="dwell.js"></script>
 *   <button class="dwell">Play</button>                        // default hold
 *   <button class="dwell" data-dwell-ms="1600">Done</button>   // deliberate hold
 *   <div class="dwell" data-dwell-noclick>...</div>            // event only, no click()
 *   <button class="dwell" data-dwell-say="turn the page">…</button>  // spoken preview text
 *
 * v2 (from the Fable 5 review):
 *   - LOOK-AWAY FORGIVENESS: leaving a target PAUSES progress; within graceMs it
 *     resumes where it was, then decays gently instead of hard-resetting (OptiKey
 *     model). A brief glance away no longer punishes her.
 *   - GAZE BUS: connects to RaeGaze at ws://127.0.0.1:49155. When the tracker
 *     reports invalid/stale (blink, look-away, head turn), dwell PAUSES — a frozen
 *     cursor can never complete a selection. (This was the false-activation bug.)
 *   - AUDITORY PREVIEW: speaks the target's label when dwell starts (recommended in
 *     the Rett consensus literature) and plays a soft chime on activation.
 *   - REACTIVATION ANCHOR (from Aivota): after firing, nothing re-arms until gaze
 *     moves rearmPx away from the firing point — no accidental double-fires.
 *   - HYSTERESIS: a padded halo around the current target absorbs boundary jitter
 *     (unless gaze is genuinely inside a different target).
 *   - PAGE-SETTLE (v6.2, 27P #5b): Dwell.suppress(ms?) blocks gaze arming for a
 *     settle window after the app re-renders its surface — a fresh page never
 *     inherits her gaze. Touch paths are unaffected.
 *
 * Configure globally before load (all optional):
 *   window.DwellConfig = {
 *     ms: 1200,            // default hold time (start generous; ramp down on evidence)
 *     graceMs: 400,        // look-away pause window before decay starts (matches all apps)
 *     decayMs: 900,        // full->empty decay time after grace expires
 *     padPx: 12,           // hysteresis halo around the current target
 *     rearmPx: 40,         // must move this far from the fire point to re-arm
 *     audioPreview: true,  // speak the label at dwell start
 *     chime: true,         // soft tone on activation
 *     bus: "auto",         // "auto" | "off" | explicit ws:// url
 *     staleMs: 500,        // bus samples older than this = track loss
 *     color: "#0F7C8A"
 *   };
 * Everything is also adjustable at runtime: Dwell.set({ms: 900}).
 */
(function () {
  "use strict";
  var cfg = Object.assign({
    ms: 1200, graceMs: 400, decayMs: 1000, padPx: 16, rearmPx: 48,
    audioPreview: true, chime: true, bus: "auto", staleMs: 500,
    settleMs: 250, color: "#0F7C8A", enabled: true
  }, window.DwellConfig || {});
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- affordance + fill styles (injected once) ---
  var css = document.createElement("style");
  css.textContent =
    // touch-action:NONE (7/28 v4) — manipulation still allowed PANNING, so a firm
    // slightly-moving press became a pan-candidate and Chrome fired pointercancel:
    // pressed-dim shown, then no pointerup, no click, nothing. Our apps are kiosk
    // surfaces that never scroll; a touch that starts on a target belongs to the
    // target, full stop. Tap-parity law (7/27-28).
    ".dwell{position:relative;touch-action:none;transition:filter .08s}" +
    ".dwell-pressed{filter:brightness(.82)}" +
    ".dwell-fx{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit;z-index:2}" +
    ".dwell-fill{position:absolute;left:0;right:0;bottom:0;height:0;background:" + cfg.color +
      ";opacity:.28;will-change:height}" +
    ".dwell-paused .dwell-fill{opacity:.14}" +   // frozen fill dims while she looks away
    ".dwell-ring{position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 0 " + cfg.color + ";transition:box-shadow .12s}" +
    ".dwell-active .dwell-ring{box-shadow:inset 0 0 0 3px " + cfg.color + "}" +
    ".dwell-paused .dwell-ring{box-shadow:inset 0 0 0 3px rgba(120,132,136,.55)}" +
    ".dwell-flash{position:absolute;inset:0;border-radius:inherit;background:" + cfg.color +
      ";opacity:0;pointer-events:none;z-index:3}";
  document.head.appendChild(css);

  // --- state ---
  var current = null;        // element being dwelled
  var progressMs = 0;        // accumulated hold on `current` (survives brief look-aways)
  var lastStep = 0;          // rAF timestamp of the last update
  var away = false;          // gaze currently off `current` (grace/decay running)
  var awaySince = 0;
  var firePoint = null;      // {x,y} of the last activation (reactivation anchor)
  var lastPt = { x: -1, y: -1 };
  var raf = null;
  var paused = false;        // track-loss pause (from the gaze bus)
  var suppressUntil = 0;     // page-settle (27P #5b): gaze arming blocked until this time
  var lastSampleAt = 0;      // performance.now() of the last valid bus sample
  var busConnected = false;

  function holdMs(el) {
    var v = el.getAttribute("data-dwell-ms");
    var n = v ? parseInt(v, 10) : cfg.ms;
    return (isFinite(n) && n > 0) ? n : cfg.ms;
  }
  function padPx(el) {
    var v = el.getAttribute("data-dwell-pad");
    var n = v ? parseInt(v, 10) : cfg.padPx;
    return (isFinite(n) && n >= 0) ? n : cfg.padPx;
  }

  function fx(el) {
    // An app that rewrites a persistent target's innerHTML detaches our fx layer
    // while this cache survives — the engine would then fill a ghost node and the
    // tile shows NO rising fill (dad-reported 8/2: the Pencil's back seat).
    // Re-inject whenever the cached nodes are no longer connected.
    if (el._dwellFx && el._dwellFx.fill.isConnected) return el._dwellFx;
    var wrap = document.createElement("div"); wrap.className = "dwell-fx";
    var fill = document.createElement("div"); fill.className = "dwell-fill";
    var ring = document.createElement("div"); ring.className = "dwell-ring";
    var flash = document.createElement("div"); flash.className = "dwell-flash";
    wrap.appendChild(fill); wrap.appendChild(flash); wrap.appendChild(ring);
    el.appendChild(wrap);
    el._dwellFx = { fill: fill, flash: flash };
    return el._dwellFx;
  }

  // --- audio: spoken preview + activation chime ---
  var actx = null;
  function chime() {
    if (!cfg.chime || reduce) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 740; o.type = "sine";
      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.28);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + 0.3);
    } catch (e) { /* audio unavailable — never block activation */ }
  }
  function labelOf(el) {
    return el.getAttribute("data-dwell-say") || el.getAttribute("aria-label") ||
           (el.textContent || "").trim().slice(0, 60);
  }
  function speak(el) {
    if (!cfg.audioPreview || !window.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      var text = labelOf(el);
      if (!text) return;
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* never block on audio */ }
  }

  // --- geometry ---
  function targetAt(x, y) {
    var els = document.elementsFromPoint ? document.elementsFromPoint(x, y)
                                         : [document.elementFromPoint(x, y)];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      var hit = els[i].closest && els[i].closest(".dwell:not([data-dwell-disabled])");
      if (hit) return hit;
    }
    return null;
  }
  function inHalo(el, x, y) {   // inside the padded hysteresis rect around `el`
    var r = el.getBoundingClientRect(), p = padPx(el);
    return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
  }

  // --- rendering + the dwell clock (single rAF loop while a target is live) ---
  function render() {
    if (!current) return;
    var p = Math.min(1, progressMs / holdMs(current));
    var f = fx(current);   // through the guard: re-injects if the app rewrote innerHTML
    if (f) f.fill.style.height = (reduce ? Math.round(p * 100) : (p * 100)) + "%";
  }
  function loop(t) {
    raf = null;
    if (!current) return;
    if (!lastStep) lastStep = t;
    var dt = t - lastStep; lastStep = t;

    var trackLoss = busConnected && (paused || (performance.now() - lastSampleAt > cfg.staleMs));

    if (trackLoss) {
      // eyes lost: HOLD. Progress neither fills nor decays; a blink costs nothing
      // and a frozen cursor can never complete a selection.
      current.classList.add("dwell-paused");
    } else if (away) {
      current.classList.add("dwell-paused");
      var awayFor = performance.now() - awaySince;
      if (awayFor > cfg.graceMs) {
        progressMs -= dt * (holdMs(current) / cfg.decayMs);   // gentle decay after grace
        if (progressMs <= 0) { clear(); return; }
      }
    } else {
      current.classList.remove("dwell-paused");
      progressMs += dt;
      if (progressMs >= holdMs(current)) { activate(current); return; }
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function begin(el) {
    current = el; progressMs = 0; away = false; lastStep = 0;
    el.classList.add("dwell-active");
    fx(el);
    speak(el);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function clear() {
    if (!current) return;
    current.classList.remove("dwell-active", "dwell-paused");
    if (current._dwellFx && current._dwellFx.fill.isConnected) current._dwellFx.fill.style.height = "0";
    current = null; progressMs = 0; away = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function flashEl(el) {
    if (reduce) return;
    fx(el);                                      // ensure the fx layer exists (taps skip begin())
    var f = el._dwellFx; if (!f) return;
    f.flash.style.transition = "none"; f.flash.style.opacity = ".55";
    requestAnimationFrame(function () {
      f.flash.style.transition = "opacity .3s"; f.flash.style.opacity = "0";
    });
  }

  function activate(el) {
    firePoint = { x: lastPt.x, y: lastPt.y };   // re-arm only after gaze moves away
    clear();
    chime();   // flash is fired by the shared click listener on el.click()
    var ev = new CustomEvent("dwell:activate", { bubbles: true, cancelable: true });
    var proceed = el.dispatchEvent(ev);
    if (proceed && !el.hasAttribute("data-dwell-noclick")) el.click();
  }

  // --- pointer/gaze position updates ---
  function onMove(x, y) {
    if (!cfg.enabled) return;
    lastPt.x = x; lastPt.y = y;

    // page-settle (27P #5b): a freshly rendered surface must not inherit her
    // gaze — while suppressed, nothing arms and any live dwell clears. Touch
    // paths (pointerdown/click) bypass onMove entirely, so taps still work.
    if (performance.now() < suppressUntil) { if (current) clear(); return; }

    // reactivation anchor: after a fire, wait until gaze leaves the spot
    if (firePoint) {
      var dx = x - firePoint.x, dy = y - firePoint.y;
      if (Math.sqrt(dx * dx + dy * dy) < cfg.rearmPx) return;
      firePoint = null;
    }

    var el = targetAt(x, y);

    if (current) {
      if (el === current) { away = false; return; }
      // hysteresis: still within the halo and not inside a DIFFERENT target -> stay
      if (!el && inHalo(current, x, y)) { away = false; return; }
      // genuinely off the target: pause (grace -> decay), don't reset
      if (!away) { away = true; awaySince = performance.now(); }
      // switching straight onto another target starts it fresh
      if (el && el !== current) { clear(); begin(el); }
      return;
    }
    if (el) begin(el);
  }

  document.addEventListener("mousemove", function (e) { onMove(e.clientX, e.clientY); }, true);

  // TAP-PARITY (7/28 final, dad's on-device evidence): QUICK taps produce a
  // native click at the finger — leave that path completely alone (rev5 proof:
  // mouse + quick taps work). But Windows NEVER generates a click for a LONG
  // press: past ~600ms the touch is committed to the press-and-hold right-click
  // gesture; preventing contextmenu stops the menu but nothing turns the release
  // into a click (dad: slow press dead, quick press works — on video + log).
  // LONG-PRESS RESCUE: on a qualifying release, wait 150ms for the native click;
  // if none arrives, fire the element's click ourselves. Native-first, so quick
  // taps can never double-fire: when the native click lands, the rescue cancels.
  var tapDown = null, rescue = null;
  function cancelRescue() { if (rescue) { clearTimeout(rescue.timer); rescue = null; } }
  function scheduleRescue(el, why) {
    cancelRescue();
    var r = { el: el, timer: setTimeout(function () {
      rescue = null;
      if (!document.contains(el)) return;
      document.dispatchEvent(new CustomEvent("dwell:tap-rescued",
        { detail: { el: labelOf(el), why: why } }));
      el.click();                       // the click Windows owed us
    }, 150) };
    rescue = r;
  }
  document.addEventListener("pointerdown", function (e) {
    if (!e.isTrusted) return;                    // only REAL user presses disarm dwell
    cancelRescue();                              // a new press supersedes any pending rescue
    firePoint = { x: e.clientX, y: e.clientY };  // reuse the post-fire rearm anchor
    clear();
    var el = e.target && e.target.closest ? e.target.closest(".dwell") : null;
    if (el) {                                    // instant pressed feedback
      el.classList.add("dwell-pressed");
      setTimeout(function () { el.classList.remove("dwell-pressed"); }, 220);
    }
    tapDown = (e.pointerType === "touch" && el)
      ? { el: el, x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() } : null;
  }, true);
  document.addEventListener("pointerup", function (e) {
    if (!e.isTrusted || e.pointerType !== "touch" || !tapDown || e.pointerId !== tapDown.id) return;
    var el = tapDown.el; tapDown = null;
    if (!el || !document.contains(el)) return;
    if (!inHalo(el, e.clientX, e.clientY)) {     // released off the element: not a press
      document.dispatchEvent(new CustomEvent("dwell:tap-dropped",
        { detail: { reason: "released-off", el: labelOf(el) } }));
      return;
    }
    scheduleRescue(el, "no-native-click");       // native click (quick tap) cancels this
  }, true);
  document.addEventListener("pointercancel", function () {
    // Windows sometimes cancels the stream when it commits to the hold gesture;
    // the finger WAS on the element, so the press still deserves its click.
    if (tapDown) { var el = tapDown.el; tapDown = null; scheduleRescue(el, "pointercancel"); }
  }, true);
  // Windows long-press fires the right-click gesture (~600ms) and can cancel the
  // pointer; a press on a kiosk target is never a context menu.
  document.addEventListener("contextmenu", function (e) {
    if (e.target && e.target.closest && e.target.closest(".dwell")) e.preventDefault();
  }, true);
  // flash on the real activation (native click from touch OR mouse, and our own
  // programmatic el.click() from a gaze fire) so every activation looks the same.
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest(".dwell") : null;
    if (el && rescue && (rescue.el === el || rescue.el.contains(e.target))) cancelRescue();
    if (el) flashEl(el);
  }, true);

  document.addEventListener("mouseleave", function () {
    if (current && !away) { away = true; awaySince = performance.now(); }
  }, true);
  window.addEventListener("scroll", function () { if (lastPt.x >= 0) onMove(lastPt.x, lastPt.y); }, true);

  // --- gaze bus: validity gate (and optional direct gaze coords) ---
  var ws = null, busTries = 0;
  function busUrl() {
    if (cfg.bus === "off") return null;
    return (typeof cfg.bus === "string" && cfg.bus.indexOf("ws") === 0) ? cfg.bus : "ws://127.0.0.1:49155";
  }
  function connectBus() {
    var url = busUrl(); if (!url) return;
    try { ws = new WebSocket(url); } catch (e) { return retryBus(); }
    ws.onopen = function () { busConnected = true; busTries = 0; };
    ws.onclose = function () { busConnected = false; paused = false; retryBus(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
    ws.onmessage = function (m) {
      var d; try { d = JSON.parse(m.data); } catch (e) { return; }
      if (d && d.gazePoint !== undefined) {
        if (d.validity === 1) { paused = false; lastSampleAt = performance.now(); }
        else paused = true;   // tracker says: no eyes -> dwell holds
        // gaze-space mode: drive position straight from the bus (fullscreen kiosk pages)
        if (cfg.gazeSpace && d.validity === 1)
          onMove(d.gazePoint.x * window.innerWidth, d.gazePoint.y * window.innerHeight);
      }
    };
  }
  function retryBus() {
    if (cfg.bus === "off") return;
    var wait = Math.min(15000, 1000 * Math.pow(2, busTries++));
    setTimeout(connectBus, wait);
  }
  connectBus();

  // public API
  window.Dwell = {
    version: "6.2-page-settle",   // logged at app boot — proves which engine a device runs
    config: cfg,
    set: function (o) { Object.assign(cfg, o || {}); },
    setMs: function (n) { cfg.ms = n; },
    enable: function () { cfg.enabled = true; },
    disable: function () { cfg.enabled = false; clear(); },
    // page-settle (27P #5b): apps call this whenever the choice surface
    // re-renders (navigation, mount, reflow); default window = cfg.settleMs.
    suppress: function (ms) {
      suppressUntil = performance.now() + ((isFinite(ms) && ms > 0) ? ms : cfg.settleMs);
      clear();
    },
    state: function () {
      return { target: current ? labelOf(current) : null, progress: current ? progressMs / holdMs(current) : 0,
               away: away, paused: paused, busConnected: busConnected,
               suppressedMs: Math.max(0, suppressUntil - performance.now()) };
    }
  };
})();
