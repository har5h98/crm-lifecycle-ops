---
name: show-journey
description: Draw a live journey (Braze Canvas, Klaviyo flow, Iterable journey) as a diagram with each email's subject line, and point out structural problems. Use when someone says "show me the welcome series", "map this Canvas", "draw the flow".
argument-hint: "<journey name>"
---

# Show a journey

1. Needs a snapshot (`/refresh`, or the demo). `show_journey` with the name; if it returns candidates, ask which.
2. Show the `mermaid` diagram in a ```mermaid block. If the `archify` skill is available and they want
   something shareable, offer to render it as a polished diagram.
3. Under it: entry, exits, how many emails, and any structural findings in plain words
   (dead-end branch, unreachable steps, empty message steps).
4. If the step order isn't known (Iterable), say so plainly; the diagram then shows attached messages only.
