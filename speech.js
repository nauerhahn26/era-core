/*
 * speech.js — shared voice layer for the learning suite.
 * Prefers ElevenLabs (via the server's /tts proxy + cache) for a pleasant voice;
 * falls back to Windows speechSynthesis; reports "off" so apps can show words
 * on screen. Letter echoes ("letter" kind) cancel a still-playing previous
 * letter echo so fast typing never drifts behind her eyes.
 *
 * SERIALIZATION LAW (7/27, root fix for "voice talks over voice"): a letter
 * echo plays immediately, but any SENTENCE queued after it WAITS for the echo
 * to finish — the name+sound pairing is part of her instruction (the literacy method)
 * and must never be cut off or talked over. stop() still kills everything
 * (barge-in: a new user action always silences the old speech).
 */
(function () {
  "use strict";
  // test hook (inert unless window.__testHooks set BEFORE init): fake audio +
  // an event log so overlap ordering is assertable headlessly.
  const tlog = (ev, kind, text) => {
    if (!window.__testHooks) return;
    (window.__speechEngineLog = window.__speechEngineLog || [])
      .push({ t: performance.now(), ev, kind, text: (text || "").slice(0, 40) });
  };
  const clipCache = new Map();          // text -> objectURL (browser side; server caches mp3s too)
  let mode = null;                      // 'eleven' | 'local' | 'off'
  let localVoice = null;
  let current = null, currentKind = null;

  function pickLocal() {
    if (!window.speechSynthesis) return;
    const vs = speechSynthesis.getVoices();
    localVoice = vs.find(v => /en[-_](US|GB)/i.test(v.lang) && /female|Zira|Jenny|Aria|Libby/i.test(v.name))
              || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = pickLocal; pickLocal(); }

  async function fetchClip(text) {
    if (clipCache.has(text)) return clipCache.get(text);
    const r = await fetch("/tts", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error("tts " + r.status);
    const url = URL.createObjectURL(await r.blob());
    clipCache.set(text, url);
    return url;
  }
  function playClip(url, text, kind) {
    return new Promise(res => {
      const a = new Audio(url);
      current = a; currentKind = kind;
      let done = false; const fin = ok => { if (!done) { done = true; res(ok); } };
      a.onended = () => fin(true);
      a.onerror = () => fin(false);
      a.play().then(() => {}).catch(() => fin(false));
      setTimeout(() => fin(true), Math.min(14000, 1500 + text.length * 95));
    });
  }
  async function sayEleven(text, kind) {
    try { return await playClip(await fetchClip(text), text, kind); }
    catch { return false; }
  }
  function sayLocal(text, kind) {
    return new Promise(res => {
      if (!window.speechSynthesis || !text) return res(true);
      let done = false; const fin = () => { if (!done) { done = true; res(true); } };
      const u = new SpeechSynthesisUtterance(text);
      if (localVoice) u.voice = localVoice;
      u.rate = 0.92; u.onend = fin; u.onerror = fin;
      currentKind = kind;
      speechSynthesis.speak(u);
      setTimeout(fin, Math.min(9000, 1200 + text.length * 75));
    });
  }
  function stopIfLetterEcho() {
    if (currentKind !== "letter") return;
    try { if (current) current.pause(); } catch {}
    try { if (window.speechSynthesis && speechSynthesis.speaking) speechSynthesis.cancel(); } catch {}
  }

  async function init(sample) {
    if (window.__testHooks) { mode = "test"; return mode; }  // deterministic fake audio
    try {
      const v = await (await fetch("/voices")).json();
      if (v.enabled && await sayEleven(sample || "Hello!", "long")) { mode = "eleven"; return mode; }
    } catch {}
    // local self-test: does an utterance actually start?
    const started = await new Promise(res => {
      if (!window.speechSynthesis) return res(false);
      let ok = false;
      const u = new SpeechSynthesisUtterance(sample || "Hello!");
      if (localVoice) u.voice = localVoice;
      u.onstart = () => { ok = true; };
      u.onend = () => res(ok); u.onerror = () => res(false);
      speechSynthesis.speak(u);
      setTimeout(() => res(ok), 3000);
    });
    mode = started ? "local" : "off";
    return mode;
  }

  let chain = Promise.resolve();   // long utterances play strictly one-at-a-time
  let gen = 0;                     // barge-in generation: stop() invalidates queued speech
  let letterEcho = Promise.resolve(); // in-flight letter echo; sentences wait for it
  let letterSeq = 0;               // newest letter echo wins — EVEN while its clip is
                                   // still fetching (a stale echo must never start;
                                   // rapid taps used to queue every echo, dad 7/28)
  async function speakNow(text, kind, myGen) {
    if (myGen !== gen) return;     // superseded by a user action — never play stale prompts
    if (mode === "test") {         // fake playback: real timing shape, no audio
      tlog("start", kind, text);
      await new Promise(r => setTimeout(r, 60 + Math.min(240, text.length * 4)));
      tlog("end", kind, text);
      return;
    }
    if (mode === "eleven") { if (await sayEleven(text, kind)) return; }
    if (myGen !== gen) return;
    await sayLocal(text, kind);
  }
  function say(text, kind) {
    kind = kind || "long";
    tlog("say", kind, text);
    if (!text || mode === "off") return Promise.resolve();
    const myGen = gen;
    if (kind === "letter") {
      stopIfLetterEcho();
      const mySeq = ++letterSeq;
      const fresh = () => myGen === gen && mySeq === letterSeq;
      letterEcho = (async () => {
        if (!fresh()) return;
        if (mode === "test") { if (fresh()) await speakNow(text, kind, myGen); return; }
        if (mode === "eleven") {
          try {
            const url = await fetchClip(text);   // network — a newer tap may land meanwhile
            if (!fresh()) return;                // superseded: never start the stale clip
            if (await playClip(url, text, kind)) return;
          } catch (e) { /* fall through to local */ }
        }
        if (!fresh()) return;
        await sayLocal(text, kind);
      })().catch(() => {});
      return letterEcho;
    }
    // SERIALIZATION LAW: wait for the chain AND any in-flight letter echo
    // (evaluated at run time, so the freshest echo wins) before speaking.
    chain = chain.then(() => letterEcho).then(() => speakNow(text, kind, myGen)).catch(() => {});
    return chain;
  }
  // BARGE-IN: the user acted — kill current audio AND everything queued behind it.
  function stop() {
    gen++;
    letterSeq++;                   // in-flight letter fetches die with the barge-in too
    tlog("stop");
    try { if (current) { current.pause(); current = null; } } catch {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch {}
    chain = Promise.resolve();
    letterEcho = Promise.resolve();
  }

  async function preload(texts) {
    if (mode !== "eleven") return;
    for (const t of texts) { try { await fetchClip(t); } catch {} }
  }

  async function cycleVoice() {
    try {
      const v = await (await fetch("/voices")).json();
      if (!v.enabled) { await say("Voices need a key first — check with dad."); return null; }
      const idx = v.voices.findIndex(x => x.id === v.current);
      const next = v.voices[(idx + 1) % v.voices.length];
      await fetch("/voice", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: next.id }) });
      clipCache.clear();
      await say("Hi " + (window.ERA_CHILD_NAME || "friend") + "! I'm " + next.name.split(" — ")[0] + ". I can be your helper voice!");
      return next;
    } catch { return null; }
  }

  window.Speech = { init, say, stop, preload, cycleVoice, mode: () => mode };
})();
