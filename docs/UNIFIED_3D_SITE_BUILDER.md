# Unified 3D Site Builder

**Goal**
- Provide one builder surface for 3D interactive marketing sites, without duplicative “Page Builder” vs “Site Builder” navigation.
- Keep a single canonical generation schema (Dynamic Pages) and use the Site Builder as the multi-page wrapper.

**User-Facing Routes**
- `GET /builder/site`: Multi-page Site Builder (standard sites + Vibe sites).
- `GET /builder/pages`: Dynamic Pages (WebGL hero + AI-composed layout tree).
- `GET /builder`: Canonicalizes to `GET /builder/site`.
- Legacy redirects:
  - `GET /site-builder` → `/builder/site`
  - `GET /dynamic-pages` → `/builder/pages`

**Sidebar Noise Reduction**
- Sidebar “BUILDERS” now exposes a single entry: `3D Site Builder` → `/builder/site`.
- Other builder tools stay available but are not duplicated as “page vs site” surfaces.
- Implementation: `client/src/components/layout.tsx`

## Architecture

**Source Of Truth**
- The canonical “3D interactive page” representation is `DynamicPageSchema` (`client/src/lib/dynamic-pages/schema.ts`).
- Key idea: the 3D experience is a WebGL hero scene (React Three Fiber / Three.js) plus a layout tree for the rest of the page.

**Rendering**
- `DynamicPageRenderer` always renders the WebGL hero and then renders the composed layout tree below it.
- `schema.scene.fallbackImage` is an optional background layer behind the WebGL scene.

**Unified Builder Shell**
- `client/src/pages/builder.tsx` provides the top-level “Site vs Pages” tabs.
- It renders either the existing Site Builder or Dynamic Pages page to avoid rewriting mature tools prematurely.

## Generation APIs

**Dynamic Page: full generation**
- `POST /api/dynamic-pages/generate`
- Input: `{ prompt, subAccountId, imageUrl?, generationMode? }`
- Output: `{ schema }`

**Dynamic Page: incremental patch**
- `POST /api/dynamic-pages/patch`
- Input: `{ prompt, existingSchema, subAccountId }`
- Output: `{ schema }`

**Dynamic Page: hero image**
- `POST /api/dynamic-pages/generate-image`
- Input: `{ prompt, niche?, businessType?, style? }`
- Output: `{ imageUrl }`
- Client wiring: `client/src/components/dynamic-pages/PromptDesignPanel.tsx` button `Hero Image` writes the URL to `schema.scene.fallbackImage`.

**Dynamic Page: regenerate only the 3D scene**
- `POST /api/dynamic-pages/generate-scene`
- Input: `{ prompt }`
- Output: `{ scene }`
- Client wiring: `client/src/components/dynamic-pages/PromptDesignPanel.tsx` button `3D Scene` replaces `schema.scene` while preserving `fallbackImage` when the generator does not return one.

## Vibe Sites (Premium Gating)

**What “Vibe” is**
- Vibe Sites are raw HTML sites with a 3D/animated hero (Three.js + GSAP) generated server-side.
- Endpoint: `POST /api/generate-vibe-site` (server implementation in `server/routes/sites.ts`)

**Admin Access**
- Vibe site generation is allowed for platform admins via `isPlatformAdmin(req)`.
- This avoids blocking the platform owner/admin account in local/dev environments.
- Note: the AI provider must still be configured; the admin bypass only affects “premium gating”, not provider availability.

## CSRF Requirements (Why curl can fail)

**Rule**
- All mutating `/api/*` requests require a CSRF cookie (`csrf_token`) and matching header (`x-csrf-token`) when the request is authenticated via cookies.
- If you call an endpoint like `/api/generate-vibe-site` without the header, you will see `403 { error: "CSRF token missing" }`.

**Where it is enforced**
- `server/csrfProtection.ts`

## Recommended Next Steps

**Unification, for real (phase 2)**
- Pull shared concepts into a single “builder model”:
  - `site` (multi-page wrapper, navigation, custom domain, publish)
  - `page` (DynamicPageSchema + WebGL scene + layout tree)
- Add an explicit “Add Page” flow to Site Builder that creates/imports a Dynamic Page schema and attaches it as a page.

**Quality and performance**
- Add scene budget checks to prevent mobile blowups (already exists in `validateSceneBudget`).
- Add explicit “Preview on mobile” and “Reduce motion” toggles as first-class controls (not only prompt text).

