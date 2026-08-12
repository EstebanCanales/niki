# Niki Bento Landing Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Niki's multi-section landing with one premium, minimal bento shell that feels adjacent to the macOS app while retaining a fully functional private waitlist.

**Architecture:** Keep the existing Next.js app and cloud client. Replace only the public `/` composition and its landing presentation; reuse the semantic orb and waitlist behavior, and introduce focused stateless bento surfaces around them. The authenticated portal and cloud contracts remain unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS, Vitest, Testing Library.

## Global Constraints

- One page and one centered shell; no navbar or conventional marketing footer.
- Use `niki-web/logo-niki.svg` directly as SVG and invent no substitute brand.
- Preserve waitlist normalization and every existing loading, success, duplicate, invalid, network failure, and retry behavior.
- Preserve keyboard access, visible focus, semantic regions, and reduced motion.
- Validate at 375px, 768px, 1024px, and 1440px without horizontal overflow.
- Do not modify cloud APIs or authenticated portal behavior.
- Preserve unrelated dirty worktree changes.

---

### Task 1: Build the Bento Shell landing

**Files:**
- Modify: `niki-web/src/app/page.tsx`
- Modify: `niki-web/src/app/globals.css`
- Modify: `niki-web/src/components/landing/product-demo.tsx`
- Modify: `niki-web/src/components/landing/product-demo.test.tsx`
- Create: `niki-web/src/components/landing/bento-shell.tsx`
- Create: `niki-web/src/components/landing/bento-shell.test.tsx`
- Move: `niki-web/logo-niki.svg` to `niki-web/public/logo-niki.svg`

**Interfaces:**
- Consumes: `NikiOrb`, `WaitlistForm`, `/logo-niki.svg`.
- Produces: `BentoShell(): JSX.Element`, a single public landing composition rendered by `/`.

- [ ] **Step 1: Write failing composition and interaction tests**

Assert that the page has no navigation landmark, renders exactly one `main`, references `/logo-niki.svg`, exposes the headline “Tu Mac, ahora te entiende.”, includes the functional waitlist, and switches the Presence module between escuchar, pensar, and actuar using native buttons with `aria-pressed`.

```tsx
render(<BentoShell />);
expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
expect(screen.getByRole("heading", { name: "Tu Mac, ahora te entiende." })).toBeVisible();
expect(screen.getByAltText("Niki")).toHaveAttribute("src", expect.stringContaining("logo-niki.svg"));
await user.click(screen.getByRole("button", { name: "Pensar" }));
expect(screen.getByRole("button", { name: "Pensar" })).toHaveAttribute("aria-pressed", "true");
```

- [ ] **Step 2: Run tests and confirm the new shell is absent**

Run: `cd niki-web && npm test -- bento-shell product-demo`
Expected: FAIL because `BentoShell` and the new composition do not exist.

- [ ] **Step 3: Implement the focused component structure**

Create a single shell containing identity/hero, dominant Presence, conversation, context, privacy, and access modules. Keep state only in the interactive Presence surface; keep explanatory modules stateless. Use the existing `WaitlistForm` without changing its API behavior.

- [ ] **Step 4: Replace landing-specific styling**

Remove obsolete multi-section selectors and implement named shell/bento selectors. Use an asymmetric desktop grid, two-column tablet layout, and one-column mobile layout. Use fine borders, graphite layers, restrained cyan illumination, stable hover/focus states, 44px controls, and a complete `prefers-reduced-motion` override.

- [ ] **Step 5: Run automated validation**

Run: `cd niki-web && npm test && npm run typecheck && npm run build`
Expected: all tests pass, TypeScript exits 0, and Next.js build succeeds.

- [ ] **Step 6: Commit**

```bash
git add niki-web/src/app/page.tsx niki-web/src/app/globals.css niki-web/src/components/landing niki-web/public/logo-niki.svg
git commit -m "feat: redesign Niki landing as bento shell"
```

### Task 2: Perform responsive visual QA and polish

**Files:**
- Modify: `niki-web/src/app/globals.css`
- Modify if required: `niki-web/src/components/landing/bento-shell.tsx`
- Modify if required: `niki-web/src/components/landing/niki-orb.tsx`

**Interfaces:**
- Consumes: completed Bento Shell at `http://localhost:3001`.
- Produces: verified layouts at 375px, 768px, 1024px, and 1440px.

- [ ] **Step 1: Inspect desktop and mobile captures**

At every target width, verify the full shell, logo area, headline, Presence module, conversation, privacy/context, and access form. Check for clipping, accidental horizontal scroll, weak borders, cramped text, and broken hierarchy.

- [ ] **Step 2: Apply only evidence-based visual corrections**

Adjust layout tracks, spacing, radius, type scale, contrast, or bitmap rounding only where inspection reveals a defect. Do not add sections, navigation, decorative stock assets, or new product claims.

- [ ] **Step 3: Re-run all gates**

Run: `cd niki-web && npm test && npm run typecheck && npm run build`
Expected: all commands pass after final polish.

- [ ] **Step 4: Commit visual corrections if any**

```bash
git add niki-web/src/app/globals.css niki-web/src/components/landing
git commit -m "fix: polish Niki bento landing responsiveness"
```
