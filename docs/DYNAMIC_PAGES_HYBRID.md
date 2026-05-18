# Dynamic Pages — Hybrid 3D + AI HTML Architecture

**Date:** 2026-05-18  
**Branch:** claude/amazing-banach-2834a7  
**PR:** #32

---

## Overview

Dynamic Pages uses a **hybrid rendering model** that combines:

1. **WebGL 3D hero** — React Three Fiber scene with particles, bloom, chromatic aberration, and orbit controls. Always rendered. Driven by `schema.scene`.
2. **AI-generated Tailwind HTML sections** — Claude writes the actual HTML for features, stats, testimonials, CTA, and contact form based on the user's exact prompt. Rendered in a sandboxed `<iframe srcdoc>` below the hero.

```
┌─────────────────────────────────────────┐
│  WebGL 3D Hero  (React Three Fiber)     │  ← unchanged from original design
│  Particles · Bloom · Orbit Controls     │
│  Overlay: headline + subheadline + CTA  │
└─────────────────────────────────────────┘
│  AI-generated Tailwind HTML sections    │  ← Claude writes this per prompt
│  Features · Stats · Testimonials        │  "dog groomer" → dog-specific copy,
│  CTA Banner · Contact Form              │  niche fields, realistic testimonials
└─────────────────────────────────────────┘
```

This replaces the old fixed schema-driven section renderer (`FeaturesSection`, `StatsSection`, etc.) which always looked the same regardless of the prompt.

---

## What Changed

### `client/src/lib/dynamic-pages/schema.ts`
- Added `generatedHtml?: string` to `DynamicPageSchema`
- This field holds the AI-generated Tailwind HTML for below-hero sections
- Optional — old schemas without it fall back to fixed section components

### `server/services/aiPromptToPageSchema.ts`
- Added `HTML_SECTIONS_SYSTEM_PROMPT` — system prompt that instructs Claude to write niche-specific Tailwind HTML
- Added `sanitizeHtml()` — strips `<script>`, `<iframe>`, and inline event handlers from AI output
- Added `generateSectionsHtml(prompt, schema, intent)` — calls `aiChat` to generate HTML sections
- Updated `generatePageSchema()` — runs schema generation, then calls `generateSectionsHtml()` with the real schema copy + theme colors. Result stored in `schema.generatedHtml`
- Updated `patchExistingPageSchema()` — also regenerates HTML sections after patching the schema

### `client/src/components/dynamic-pages/DynamicPageRenderer.tsx`
- Added `buildIframeDoc(html, colors)` — wraps AI HTML in a full document with Tailwind CDN, CSS custom properties, and Inter font
- Added `HtmlSectionsIframe` component — renders `schema.generatedHtml` in a sandboxed iframe, auto-resizes on load
- Updated `DynamicPageRenderer` — uses `HtmlSectionsIframe` when `generatedHtml` is present, otherwise falls back to fixed section components

---

## How It Works

### Generation flow

```
User types: "personal injury law firm, dark dramatic, animated stats"
     ↓
POST /api/dynamic-pages/generate
     ↓
generatePageSchema()
  ├── aiChat (JSON mode) → DynamicPageSchema (WebGL scene config, copy, theme)
  └── generateSectionsHtml() → raw Tailwind HTML for below-hero sections
           ↓
    Claude receives:
    - Niche, business type, style
    - Actual headline/subheadline from generated schema
    - Theme hex colors
           ↓
    Returns: <section> blocks with Tailwind classes
    - Features grid (glassmorphism cards)
    - Stats bar ("$2.4M avg. settlement", "93% win rate")
    - Testimonials (niche-specific client quotes)
    - CTA banner (gradient background)
    - Contact form (accident date, injury type, etc.)
     ↓
schema.generatedHtml = sanitized HTML
     ↓
Frontend: DynamicPageRenderer
  ├── WebGLSceneRenderer (3D hero, always shown)
  └── HtmlSectionsIframe (AI HTML in sandboxed iframe)
```

### Iframe sandbox

```html
<iframe
  srcDoc={buildIframeDoc(schema.generatedHtml, schema.theme.colors)}
  sandbox="allow-scripts allow-forms allow-same-origin"
  style="width: 100%; border: none; min-height: 600px"
/>
```

- `allow-scripts` — required for Tailwind CDN to run
- `allow-forms` — allows contact form submission
- `allow-same-origin` — allows iframe to read its own `scrollHeight` for auto-resize
- No `allow-top-navigation` — iframe cannot redirect the parent page

### CSS custom properties in generated HTML

Claude uses CSS variables that are injected into the iframe `<style>` block:

```css
:root {
  --primary: #6366f1;
  --secondary: #a855f7;
  --accent: #06b6d4;
  --bg: #030712;
  --surface: #0f172a;
  --text: #f8fafc;
  --text-muted: #94a3b8;
}
```

Claude uses `style="color: var(--primary)"` for dynamic theme color accents alongside Tailwind classes.

### Security

- `sanitizeHtml()` strips `<script>`, `<iframe>`, and `on*` event handlers before storing
- Tailwind CDN is injected by `buildIframeDoc()`, not by Claude — Claude cannot inject arbitrary scripts
- iframe sandbox prevents top-level navigation and popup creation

---

## Fallback Behavior

If `generateSectionsHtml()` fails (AI timeout, error), `generatedHtml` is left undefined and `DynamicPageRenderer` falls back to the original fixed section components. This means:

- Pages generated before this change render correctly
- API failures gracefully degrade to the old renderer
- No breaking change to existing saved schemas

---

## Prompt Design

### `HTML_SECTIONS_SYSTEM_PROMPT` key rules
1. No wrapper tags — Claude returns only inner body HTML
2. Tailwind CSS only — no custom CSS
3. Niche-specific copy required — no generic placeholders
4. Stats must be realistic and impressive for the niche
5. Testimonials: real client first name + last initial + specific result
6. Contact form fields must match the niche (law → accident date; pet → breed, services)
7. No hero section — the WebGL hero is already above
8. No navigation bar or footer — handled by the platform

---

## Known Limitations

| Issue | Status |
|---|---|
| iframe height auto-resize requires `allow-same-origin` | Acceptable — content is from our AI |
| Tailwind CDN adds ~300ms load on first render | Acceptable for preview; CDN is cached |
| iframe form submissions don't hit the Apex CRM pipeline | Future work — need postMessage bridge |
| Re-prompt (patch) regenerates entire HTML sections | Expected — patch flow calls `generateSectionsHtml` |

---

## Future Work

- **postMessage bridge** — allow iframe form submissions to fire `FORM_SUBMITTED` events into the Apex CRM pipeline
- **GLB 3D model loading** — when user requests specific objects (snake, dog, etc.), load a matching GLB from a model library as a Three.js mesh instead of a primitive
- **DALL-E hero image layer** — optionally generate an AI background image layered behind the WebGL primitives for photo-realistic hero scenes
- **Per-section regeneration** — allow users to re-prompt individual sections without regenerating the full page
