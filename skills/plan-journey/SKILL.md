---
name: plan-journey
description: Design a new lifecycle journey (welcome, onboarding, win-back, post-purchase…) and check it against what's already live for audience overlap, trigger collisions and shared data. Use when someone says "plan a journey", "design a flow", "I want to build a win-back", or "will this collide with anything".
argument-hint: "<goal or brief>"
---

# Plan a journey

1. **Brief** (ask only what's missing): goal and success metric · who enters and the trigger (event,
   segment or list) · who should be excluded · channels · timing constraints · offer.
2. **Draft the journey**: entry → steps (message / wait / split), exits and conversion event. For each
   message: purpose, subject idea, key personalization and its fallback. Keep it as simple as the goal allows.
   For lifecycle craft (benchmarks, sequence patterns), the `lifecycle-marketing` skill can help if installed.
3. **Check it against what's live** (needs a snapshot; offer `/refresh` or the demo): call `find_overlaps`
   with the planned segments/lists, trigger events and personalization attributes. Report:
   - live programs that already target the same people or trigger on the same event, and the risk
     (double sends, conflicting offers, frequency-cap pressure);
   - live items we can't rule out (unknown targeting), and offer to read them from the dashboard (see `/what-breaks`);
   - suggested fixes: exclusions, a priority rule, a shared suppression segment, or changed timing.
4. **Show it**: a Mermaid flowchart of the planned journey (render with the `archify` skill if available).
5. Offer `/build-plan` to turn it into a step-by-step build checklist.
