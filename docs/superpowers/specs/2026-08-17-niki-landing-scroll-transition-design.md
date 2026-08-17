# Niki Landing Scroll Transition Design

## Objective

Rebuild the transition between the landing hero and the expanding product panel so the page scrolls naturally, no sections overlap, and the animation starts only after the hero has left the viewport.

## Structure

The page uses three independent document-flow regions:

1. A `100svh` hero containing the navbar, LineWaves background, copy, and calls to action.
2. A short white transition region that gives the hero time to leave before the animation begins.
3. A dedicated scroll-animation section containing a sticky viewport and the expanding dark panel.

No negative margins, translated layout wrappers, or cross-section absolute positioning are allowed between these regions.

## Scroll Behavior

- The first user scroll moves the hero upward normally.
- The expanding panel does not animate while the hero is still the primary visible surface.
- Animation progress begins when the panel section reaches its sticky activation point.
- GSAP maps section progress directly to panel width, height, radius, and content reveal.
- The sticky period ends shortly after the panel reaches its final state so the page continues naturally.
- Scrolling upward reverses the animation smoothly without leaving the hero trapped beneath the panel.

## Layout and Margins

- Hero content uses one consistent centered container.
- The expanding panel uses `12px` mobile and `16px` desktop outer margins at its final size.
- Vertical viewport margins remain visually equal while the panel is pinned.
- The initial panel is large enough to communicate the next section without creating excessive empty space.
- Border radius transitions from approximately `28px` to `18px`; it never reaches square corners.

## Visual Direction

- White editorial hero with black typography and subtle LineWaves motion.
- Dark product panel with restrained grid texture, low-contrast highlights, and a thin translucent border.
- Motion supports hierarchy and spatial continuity; it does not move the hero or navbar.
- One dominant headline and one supporting sentence inside the panel.

## Responsive and Accessibility

- Use `svh` units where viewport height matters.
- Disable or simplify interpolation for `prefers-reduced-motion`.
- Preserve readable text contrast and avoid hiding interactive content during the animation.
- On narrow screens, the panel starts wider and uses tighter internal padding.

## Validation

- Confirm no overlap at the hero-to-panel boundary.
- Confirm the hero leaves before panel expansion begins.
- Confirm the panel reaches its final size with small, equal margins.
- Confirm the sticky section releases in both scroll directions.
- Run frontend typecheck and build validation.
