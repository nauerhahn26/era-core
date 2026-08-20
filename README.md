# era-core

The shared foundation of the **New ERA Communications** eye-gaze app family:

- `dwell.js` — the dwell/selection engine: sustain-to-select with look-away grace
  and gentle decay, hysteresis halo, track-loss hold, tap parity (touch works
  everywhere gaze does), page-settle suppression, gaze-bus client.
- `speech.js` — serialized speech engine (barge-in law: a child's action always
  interrupts speech), TTS with system-voice fallback.
- `lib/contract.js` (+ generated `contract.json`) — the UX contract: every hold
  time, font floor, and target size in one governed place. Apps never invent
  values.
- `lib/tokens.css`, `lib/shell.js`, `lib/celebrate.js` — shared visual tokens,
  app shell, celebration effects.

These engines are safety-critical for eye-gaze users: apps consume them, never
fork them. Versioned releases; each New ERA app pins the version it has tested
against.

Built for Ellie, a six-year-old who communicates by eye gaze; shared so any
family can use it. License: MPL-2.0 (see LICENSE, NOTICE).
