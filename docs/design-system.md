# VoxPopuli Design System — "Data Noir Editorial"

> Where raw terminal output meets investigative journalism.

## Aesthetic Direction

VoxPopuli's design reflects its dual nature: an AI agent that processes raw Hacker News data (terminal, monospace, technical) and produces polished, sourced editorial content (serif typography, trust indicators, editorial prose). The dark OLED palette nods to the hacker audience while amber accents evoke the warmth of HN's own orange identity.

The homepage applies a `vp-noise` film grain texture overlay on the body for a tactile, analog feel, paired with a radial amber gradient on the hero section that fades outward from center. This creates depth and draws the eye to the search bar.

## Typography

Three-font strategy with clear role separation:

| Font               | CSS Class                           | Role      | Usage                                      |
| ------------------ | ----------------------------------- | --------- | ------------------------------------------ |
| **Newsreader**     | `text-editorial` / `font-editorial` | Editorial | Headings, answer prose, page titles        |
| **Public Sans**    | `text-ui` / `font-ui`               | Interface | Body text, labels, navigation, UI chrome   |
| **JetBrains Mono** | `text-mono` / `font-mono`           | Technical | Agent steps, badges, metadata, code blocks |

### Type Scale

- **H1**: 2.25rem / Newsreader / font-semibold / tracking-tight
- **H2**: 1.75rem / Newsreader / font-semibold
- **H3**: 1.25rem / Newsreader / font-semibold
- **Body**: 1rem / Public Sans / line-height 1.6
- **Mono**: 0.875rem / JetBrains Mono
- **Caption**: 0.75rem / JetBrains Mono

## Color Palette

### Surfaces (Dark OLED)

| Token   | Hex       | Tailwind Class       | Usage                |
| ------- | --------- | -------------------- | -------------------- |
| void    | `#000000` | `bg-surface-void`    | Terminal backgrounds |
| base    | `#020617` | `bg-surface-base`    | Page background      |
| raised  | `#0F172A` | `bg-surface-raised`  | Cards, panels        |
| overlay | `#1E293B` | `bg-surface-overlay` | Dropdowns, tooltips  |
| float   | `#334155` | `bg-surface-float`   | Hover states         |

### Accents

| Token      | Hex       | Tailwind Class                          | Usage                      |
| ---------- | --------- | --------------------------------------- | -------------------------- |
| amber      | `#F59E0B` | `text-accent-amber` / `bg-accent-amber` | Primary accent, links, CTA |
| amber-glow | `#FBBF24` | `text-accent-amber-glow`                | Hover states               |
| amber-dim  | `#B45309` | `text-accent-amber-dim`                 | Subdued accent             |
| blue       | `#3B82F6` | `text-accent-blue`                      | Information, cached state  |
| orange     | `#F97316` | `text-accent-orange`                    | Warnings                   |

### Trust / Semantic

| Token    | Hex       | Tailwind Class        | Usage                     |
| -------- | --------- | --------------------- | ------------------------- |
| verified | `#22C55E` | `text-trust-verified` | Source verified, success  |
| caution  | `#EAB308` | `text-trust-caution`  | Show HN flag, old sources |
| warning  | `#F97316` | `text-trust-warning`  | Missing data              |
| danger   | `#EF4444` | `text-trust-danger`   | Errors, failures          |

### Agent Step Colors

| Step Type   | Hex       | Badge Class             | Usage           |
| ----------- | --------- | ----------------------- | --------------- |
| thought     | `#A78BFA` | `vp-badge--thought`     | Agent reasoning |
| action      | `#38BDF8` | `vp-badge--action`      | Tool calls      |
| observation | `#34D399` | `vp-badge--observation` | Tool results    |
| error       | `#F87171` | `vp-badge--error`       | Errors          |

### Text Colors

| Token     | Hex       | Tailwind Class        |
| --------- | --------- | --------------------- |
| primary   | `#F8FAFC` | `text-text-primary`   |
| secondary | `#94A3B8` | `text-text-secondary` |
| muted     | `#64748B` | `text-text-muted`     |
| faint     | `#475569` | `text-text-faint`     |
| inverse   | `#0F172A` | `text-text-inverse`   |

## Component Classes

All components are defined as CSS classes in `apps/web/src/styles.css` via `@layer components`.

### Cards

```html
<!-- Standard card -->
<div class="vp-card p-5">Content</div>

<!-- Interactive card (clickable, amber glow on hover) -->
<div class="vp-card vp-card--interactive p-5">Clickable content</div>

<!-- Source card (for HN stories) -->
<div class="vp-source-card">
  <p class="vp-source-card__title">Story title</p>
  <div class="vp-source-card__meta">metadata</div>
</div>
```

### Badges

```html
<span class="vp-badge vp-badge--thought">thought</span>
<span class="vp-badge vp-badge--action">search_hn</span>
<span class="vp-badge vp-badge--observation">5 results</span>
<span class="vp-badge vp-badge--error">timeout</span>
<span class="vp-badge vp-badge--verified">verified</span>
<span class="vp-badge vp-badge--cached">cached</span>
```

### Buttons

```html
<button class="vp-btn-primary">Ask VoxPopuli</button>
<button class="vp-btn-primary" disabled>Processing...</button>
<button class="vp-btn-ghost">Listen</button>
```

### Input

```html
<input type="text" class="vp-input" placeholder="What does Hacker News think about..." />
```

### Provider Chips

```html
<span class="vp-chip vp-chip--active">groq</span> <span class="vp-chip">claude</span>
```

### Trust Indicators

Trust metadata in the answer view uses `vp-trust-indicator` boxes (bordered containers with icon + label), not the smaller `vp-badge` pills used for agent step types. Each indicator displays a single trust dimension (source verification count, recency ratio, viewpoint diversity, etc.) with the appropriate semantic color.

```html
<div class="vp-trust-indicator">
  <svg><!-- icon --></svg>
  <span class="text-trust-verified">4/4 verified</span>
</div>
```

### Terminal / Agent Output

```html
<div class="vp-terminal">
  <!-- Agent steps rendered here -->
</div>
```

### Answer Prose

```html
<div class="vp-prose">
  <p>
    Editorial-styled answer text with <strong>bold highlights</strong> and
    <a href="#">source links</a>.
  </p>
</div>
```

### Loading States

```html
<!-- Skeleton loader -->
<div class="vp-skeleton h-5 w-3/4"></div>

<!-- Typewriter cursor -->
<span class="vp-cursor">text</span>

<!-- Live pulse indicator -->
<span class="vp-pulse">streaming</span>
```

### Utilities

```html
<!-- Glow effects -->
<div class="glow-amber">Amber glow shadow</div>
<div class="glow-blue">Blue glow shadow</div>
<div class="glow-green">Green glow shadow</div>

<!-- Divider -->
<hr class="vp-divider" />

<!-- Noise texture (applied to body) -->
<body class="vp-noise"></body>
```

## Page-Level Patterns

### Homepage (Landing)

The landing page is structured in four vertical sections:

1. **Hero**: Radial amber gradient background, Newsreader headline, subtitle in Public Sans secondary, and a centered search bar. The search input applies a subtle `scale(1.005)` on focus for tactile feedback. The submit button has a `vp-ready-pulse` animation on hover (a gentle amber glow pulse indicating readiness).

2. **Example Questions**: A "Try asking" divider separates the hero from a 3-column (2-row on desktop, stacked on mobile) grid of example cards. Each card is numbered 01 through 06 with a mono label and uses `vp-card--interactive` styling. The currently previewed card gains `shadow-lg` elevation with `glow-amber` to indicate selection, and displays a "Live preview" pulsing indicator.

3. **How It Works**: An editorial timeline layout replaces the earlier 3-column grid. A left-aligned vertical spine (gradient from amber to transparent) connects three numbered steps. Each step sits to the right of the spine with a heading and description, creating a narrative flow rather than a feature grid.

4. **Footer**: Contains a "Try it now" call-to-action that scrolls back to the search bar, plus a version badge in mono text.

### Results Page

The results view features a sticky header with `backdrop-blur` for content readability during scroll. Below the header, a tab bar switches between Answer, Sources, and Agent Steps views. The active tab uses a `bg-surface-overlay/40` fill rather than an underline indicator.

## Light Theme

Light mode is toggled via a `.light` class on `<html>`. Key overrides:

- The terminal/agent-steps area retains its dark background even in light mode for contrast and readability.
- The `vp-noise` texture opacity is increased in light mode to remain perceptible against lighter surfaces.
- `surface-overlay` tokens are adjusted for stronger contrast against the light base.

## Animation & Motion

| Duration Token       | Value | Usage                 |
| -------------------- | ----- | --------------------- |
| `--duration-instant` | 100ms | Button press feedback |
| `--duration-fast`    | 150ms | Hover transitions     |
| `--duration-normal`  | 250ms | Card hover, focus     |
| `--duration-slow`    | 400ms | Panel expand/collapse |
| `--duration-reveal`  | 600ms | Page load stagger     |

Easing: `--ease-out-expo` for entrances, `--ease-in-out-quart` for transitions.

All animations respect `prefers-reduced-motion: reduce`.

## Z-Index Scale

| Token          | Value | Usage               |
| -------------- | ----- | ------------------- |
| `--z-base`     | 0     | Default content     |
| `--z-raised`   | 10    | Cards, panels       |
| `--z-dropdown` | 20    | Dropdowns, tooltips |
| `--z-sticky`   | 30    | Sticky headers      |
| `--z-overlay`  | 40    | Overlays, modals    |
| `--z-modal`    | 50    | Modal dialogs       |

## Accessibility

- WCAG AAA contrast on dark backgrounds (text-primary `#F8FAFC` on surface-base `#020617`)
- Visible focus rings (amber outline, 2px offset) on all interactive elements
- `prefers-reduced-motion` respected globally
- Minimum 44x44px touch targets on buttons
- `color-scheme: dark` set on html element

## File Structure

```
apps/web/src/
├── styles.css              # Design system (Tailwind v4 @theme + @layer components)
├── index.html              # Dark theme meta tags
└── app/
    └── pages/
        └── design-system/  # Live showcase (route: /design-system)
```

## Tailwind v4 Setup

- PostCSS config: `apps/web/.postcssrc.json` with `@tailwindcss/postcss`
- CSS-first config via `@theme {}` block (no tailwind.config.js)
- Custom utilities via `@utility` directives
- All design tokens available as Tailwind classes (e.g., `bg-surface-raised`, `text-accent-amber`)
