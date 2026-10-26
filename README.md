# era-core

The shared foundation of the **Our Era Communication Tools** eye-gaze app family:

- `dwell.js` — the dwell/selection engine: sustain-to-select with look-away grace
  and gentle decay, hysteresis halo, track-loss hold, tap parity (touch works
  everywhere gaze does), page-settle suppression, gaze-bus client.
- `speech.js` — serialized speech engine (barge-in law: a child's action always
  interrupts speech), TTS with system-voice fallback. Cancellation also suppresses
  clips that finish downloading after a newer action; stale failures cannot
  restart speech through the fallback voice.
- `lib/contract.js` (+ generated `contract.json`) — the UX contract: every hold
  time, font floor, and target size in one governed place. Apps never invent
  values.
- `lib/tokens.css`, `lib/shell.js`, `lib/celebrate.js` — shared visual tokens,
  app shell, celebration effects.

The shared `lib/doorbar.js` Exit callback may return a Promise for a final
local save. The bar waits at most 1200 ms before asking the hub to close the
kiosk. Existing synchronous callbacks exit immediately; Talk still opens the
communication door without a save wait.

These engines are safety-critical for eye-gaze users: apps consume them, never
fork them. Versioned releases; each Our Era Comms app pins the version it has
tested against.

Built for Ellie, a six-year-old who communicates by eye gaze; shared so any
family can use it. License: MPL-2.0 (see LICENSE, NOTICE).
