---
"@wave3d/core": patch
---

Document the coarse-pointer gate in the agent skill. `SceneConfig.interaction.touch` defaults to `false` and drops touch pointers before any handler runs, but the skill described `press` ripples as firing on a "click/tap" without saying so — so hover/press values tuned for mobile silently did nothing. The skill now states the default, that opting in does not block page scrolling, and that `scroll` / `scrollVelocity` / `appear` are unaffected because they read container progress rather than pointer events.
