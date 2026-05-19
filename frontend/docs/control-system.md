# Niki Control System

## Icons

- All visible action buttons must use `lucide-react`.
- Do not mix icon libraries on the same surface.
- Default icon size for action buttons is `16px`.
- Icon-only buttons are valid and first-class.

## Buttons

- Buttons must be self-contained surfaces.
- If a control expands, it expands in place instead of opening an extra floating input elsewhere.
- Primary actions should work as a single compact control before expansion.
- Expanded writing controls keep icon actions inside the same control body.

## Current interaction rules

- `Hablar` uses a Lucide microphone icon and triggers grid-based voice simulation.
- `Escribir` uses a Lucide pencil icon and expands in place.
- The write control may contain icon-only actions such as collapse or send.
- Voice feedback must render through the grid itself.
- Listening uses pulse-style motion.
- Agent response uses a top-to-bottom voice modulator pattern.
