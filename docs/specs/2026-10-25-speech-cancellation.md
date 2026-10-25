# Speech cancellation during a pending clip request

The math exploration feature exposed a shared speech race. A number could
finish downloading after a newer action had stopped speech and spoken a
different number. The previous generation check ran before the request,
leaving playback after the await unguarded.

Check the generation again after fetching the clip and before constructing
its audio object. Treat a cancelled successful fetch as handled so it cannot
start the fallback voice. A failed request still reaches the existing
generation check before fallback. Active failures retain local speech.
Letter echoes and the muted boot self-test keep their existing behavior.

The self-contained production-path regression controls clip completion and
audio playback. It covers replacement speech, stop without replacement,
stale failure and active fallback, without a live hub or external service.

The matching hub feature sources this worktree with
`ERA_WT_SUFFIX=--wt-math`; the assembled public copy is not the source.
