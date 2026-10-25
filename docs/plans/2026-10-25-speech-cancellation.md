# Speech cancellation regression receipt

Design: [pending clip cancellation](../specs/2026-10-25-speech-cancellation.md).
Branch: `feat/math`, paired with the hub's math feature.

- [x] Reproduce old number audio starting after stop and replacement speech.
- [x] Write a self-contained regression against the production playback path.
  Initial run: two pass, two fail.
- [x] Guard playback after asynchronous clip completion. Focused run: 4/4 pass.
- [x] Verify a packed copy uses the fixed source and suppresses cancelled audio.
- [x] Update nearest documentation and review the change independently.
- [ ] Run the complete hub gate with the matching worktree suffix and record
  the core and hub green stamps.

The application generation counter could stop newly queued count words, but
could not prevent audio creation inside the shared layer. The fix belongs
at that asynchronous boundary and also protects other callers of shared
speech. No live hub was changed and no release was published.
