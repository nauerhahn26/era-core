# Speech cancellation regression receipt

Design: [pending clip cancellation](../specs/2026-10-25-speech-cancellation.md).
Branch: `feat/math`, paired with the hub's math feature.

- [x] Reproduce old number audio starting after stop and replacement speech.
- [x] Write a self-contained regression against the production playback path.
  Initial run: two pass, two fail.
- [x] Guard playback after asynchronous clip completion. Focused run: 4/4 pass.
- [x] Verify a packed copy uses the fixed source and suppresses cancelled audio.
- [x] Update nearest documentation and review the change independently.
- [x] Run the complete hub gate with the matching worktree suffix and record
  the core and hub green stamps: 132 suites passed, zero failures on
  2026-10-25; core code `20b94f1`, hub code `7ab4e7a`, neither stamp dirty.

The application generation counter could stop newly queued count words, but
could not prevent audio creation inside the shared layer. The fix belongs
at that asynchronous boundary and also protects other callers of shared
speech. No live hub was changed and no release was published.

The final Math payload includes this fixed source and passed a production-path
late-response probe. Later receipt commits change Markdown only. The paired
feature landed on the maintainer's request: core `bb998e2`, then hub
`36795d3`, both pushed to master. The later request is a website coming-soon
notice, with the public suite release deferred. No device update or live hub
restart was performed.

The maintainer later requested installed delivery. This fix ships in suite
v1.0.12 after a fresh 132-suite green gate and eight passing Windows self-update
tests. The hub's `docs/plans/2026-10-25-math-release.md` records publication
and the separately tracked installed-device delivery status.
