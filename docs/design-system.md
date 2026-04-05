# VoxPopuli Design System — "Data Noir Editorial"

> Where raw terminal output meets investigative journalism.

## Aesthetic Direction

VoxPopuli's design reflects its dual nature: an AI agent that processes raw Hacker News data (terminal, monospace, technical) and produces polished, sourced editorial content (serif typography, trust indicators, editorial prose). The dark OLED palette nods to the hacker audience while amber accents evoke the warmth of HN's own orange identity.

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

### Surfaces (Dark OLED -- default)

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

### Light Theme

Activated by adding the `.light` class to the `<html>` element (toggled via the sun/moon button in the header).

| Token           | Dark (default) | Light override |
| --------------- | -------------- | -------------- |
| surface-void    | `#000000`      | `#FFFFFF`      |
| surface-base    | `#020617`      | `#F8FAFC`      |
| surface-raised  | `#0F172A`      | `#FFFFFF`      |
| surface-overlay | `#1E293B`      | `#F1F5F9`      |
| surface-float   | `#334155`      | `#E2E8F0`      |
| text-primary    | `#F8FAFC`      | `#0F172A`      |
| text-secondary  | `#94A3B8`      | `#475569`      |
| text-muted      | `#64748B`      | `#64748B`      |
| border-subtle   | —              | `#E2E8F0`      |
| border-default  | —              | `#CBD5E1`      |

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

```html
<div class="vp-trust-indicator">
  <svg><!-- icon --></svg>
  <span class="text-trust-verified">4/4 verified</span>
</div>
```

### Trust Bar

Trust indicators use inline pill badges with a `border-current/20 bg-current/5` pattern, where the pill's `color` is set to the trust-level color and the border/background derive from it via opacity modifiers.

```html
<span class="text-trust-verified border-current/20 bg-current/5 rounded-full px-2 py-0.5">
  4/4 verified
</span>
```

### Agent Steps

Agent steps render as compact merged rows (no wrapping `vp-terminal` container). Each step is a single row with a colored badge and inline content.

```html
<!-- Steps are rendered inline, not inside a terminal container -->
<div class="flex items-start gap-2 ...">
  <span class="vp-badge vp-badge--thought">thought</span>
  <span class="text-text-secondary text-sm">Agent reasoning text...</span>
</div>
```

### Answer Prose

Answer content is rendered via the `<markdown>` component from `ngx-markdown`, styled with the `vp-prose` class.

```html
<markdown class="vp-prose" [data]="answer"></markdown>
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
├── index.html              # Dark/light theme meta tags
└── app/
    ├── components/
    │   ├── agent-steps/    # Compact merged-row agent step display
    │   ├── chat/           # Chat interface and message rendering
    │   ├── meta-bar/       # Query metadata bar
    │   ├── provider-selector/ # LLM provider selection chips
    │   ├── source-card/    # HN story source cards
    │   └── trust-bar/      # Trust indicator pill badges
    ├── pages/
    │   └── design-system/  # Live showcase (route: /design-system)
    └── services/           # Angular services (RAG, TTS, etc.)
```

## Tailwind v4 Setup

- PostCSS config: `apps/web/.postcssrc.json` with `@tailwindcss/postcss`
- CSS-first config via `@theme {}` block (no tailwind.config.js)
- Custom utilities via `@utility` directives
- All design tokens available as Tailwind classes (e.g., `bg-surface-raised`, `text-accent-amber`)
