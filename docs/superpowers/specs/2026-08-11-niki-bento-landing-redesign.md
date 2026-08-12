# Niki Bento Landing Redesign

## Goal

Replace the current multi-section marketing landing with one focused, premium page that feels like looking into Niki without reproducing the full application. The experience must be minimal, modern, responsive, and functional.

## Visual Direction: Bento Shell

- One obsidian canvas with a subtle technical grid and restrained cyan illumination.
- One large rounded shell centered in the viewport, inspired by a macOS surface rather than a browser marketing site.
- Fine visible borders, layered graphite surfaces, soft inner highlights, and controlled depth.
- No navbar, conventional footer, pricing, testimonials, long feature sequence, or repeated calls to action.
- The user-provided `niki-web/logo-niki.svg` is the sole brand asset. It remains an SVG and appears at the top of the shell. The current asset has no visible paths, so the layout must reserve its position without fabricating a replacement mark.
- Typography remains quiet and product-like: large concise headline, readable supporting copy, and compact monospaced status labels.

## Page Composition

The page contains a single centered product shell with five regions:

1. **Identity and hero**
   - Small SVG logo area.
   - Headline: “Tu Mac, ahora te entiende.”
   - One short explanation of Niki as a personal agent for macOS.
   - Private-access language, not general SaaS marketing language.

2. **Presence module**
   - The visual anchor and largest bento cell.
   - A notch silhouette and semantic Niki orb.
   - Three accessible state controls: escuchar, pensar, actuar.
   - State transitions update the orb, status text, and contextual activity.

3. **Conversation module**
   - A concise realistic user request and Niki response.
   - Shows conversational continuity without recreating the complete chat product.

4. **Context and privacy modules**
   - Context presents a few deliberately retained memories.
   - Privacy communicates local-first control, opt-in synchronization, and confirmation before sensitive actions.
   - These are product surfaces, not generic feature cards.

5. **Access module**
   - The existing functional waitlist flow is embedded in the shell.
   - It preserves email normalization, duplicate success, validation, loading, success, network error, and retry behavior against `POST /v1/waitlist`.

## Interaction

- Hover and focus treatments change border, light, or opacity without layout movement.
- Orb state controls are native buttons with visible focus and `aria-pressed`.
- Motion is subtle and purposeful: orb breathing, state transitions, and limited entrance sequencing.
- `prefers-reduced-motion` disables continuous and entrance animation while preserving state clarity.
- The page must remain understandable without canvas output or animation.

## Responsive Behavior

- Desktop: the shell uses an asymmetric bento grid with the presence module as the dominant area.
- Tablet: modules reorganize into two columns without changing reading order.
- Mobile: one column, no horizontal scrolling, compact shell radius and gutters, full-width form controls, and touch targets at least 44px.
- The shell should feel intentionally framed at 375px, 768px, 1024px, and 1440px.

## Implementation Boundaries

- Reuse `NikiOrb`, cloud client behavior, and waitlist semantics where sound.
- Replace the current page narrative and landing-specific CSS rather than layering a second design over it.
- Split bento modules into focused components when they carry state or reusable semantics.
- Do not modify cloud API contracts or authenticated portal behavior in this redesign.
- Do not introduce external images, stock art, invented customer claims, or additional brand marks.

## Validation

- Component tests cover state controls and all waitlist outcomes.
- Accessibility checks cover labels, keyboard controls, focus visibility, semantic regions, and reduced motion.
- Run `npm test`, `npm run typecheck`, and `npm run build` in `niki-web`.
- Perform browser visual review at desktop and mobile widths after implementation, checking overflow, spacing, hierarchy, borders, and logo rendering.

## Acceptance Criteria

- The landing is one page with no navbar and no conventional marketing footer.
- It reads visually as a premium Niki product surface while remaining clearly a landing page.
- The asymmetric bento composition has strong hierarchy and polished borders/depth.
- The waitlist remains fully connected and usable.
- The user-provided logo is referenced as SVG and no substitute logo is invented.
- All tests, typecheck, build, and responsive visual checks pass.
