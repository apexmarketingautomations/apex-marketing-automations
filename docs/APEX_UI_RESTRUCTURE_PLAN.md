# APEX UI RESTRUCTURE PLAN
**Phase 5 of 11 — Frontend Navigation & Module Architecture**
Generated: 2026-05-14
Status: PLAN DOCUMENT — No UI files modified

---

## Current State

- **Framework:** React 19 + Vite + Wouter (client-side routing)
- **Pages:** 129 pages in `client/src/pages/`
- **Components:** ~300+ components in `client/src/components/`
- **UI Library:** Radix UI + shadcn/ui + Tailwind CSS v4
- **State:** TanStack Query v5 for server state
- **Auth:** Firebase + Passport.js hybrid

### Navigation Problems

1. **No top-level module grouping.** All 129 pages are at the same level — there is no concept of a "module" in the UI.
2. **Admin routes not access-controlled at the UI layer.** Any logged-in user can navigate to admin URLs if they know them.
3. **`is_admin` check uses string comparison.** Components checking `user.is_admin === 'true'` will break if the backend ever returns a boolean.
4. **Mobile responsiveness is inconsistent.** Some pages are mobile-first, others are desktop-only with horizontal scroll on small screens.
5. **No global search.** Users cannot search across contacts, cases, conversations, or campaigns from a single entry point.

---

## Target Navigation Structure

The UI must be organized into **7 primary navigation sections**, each with sub-modules:

```
┌─────────────────────────────────────────────────────────┐
│  APEX                    [Global Search]     [Account ▼] │
├──────────┬──────────────────────────────────────────────┤
│          │                                              │
│  NAV     │  CONTENT AREA                               │
│          │                                              │
│  [Home]  │                                              │
│          │                                              │
│  Contacts│                                              │
│  Inbox   │                                              │
│  Pipeline│                                              │
│          │                                              │
│  Signals │                                              │
│  Legal   │                                              │
│  Sentinel│                                              │
│          │                                              │
│  Automate│                                              │
│  Agents  │                                              │
│  Workflows│                                             │
│          │                                              │
│  Grow    │                                              │
│  Websites│                                              │
│  Ads     │                                              │
│  Content │                                              │
│          │                                              │
│  Deliver │                                              │
│  Routing │                                              │
│  Cards   │                                              │
│          │                                              │
│  Billing │                                              │
│  Settings│                                              │
│          │                                              │
│  [Admin] │  (only visible to role=admin/owner)         │
└──────────┴──────────────────────────────────────────────┘
```

---

## Module-to-Route Mapping

### Section 1: Home (/)
| Route | Page | Status |
|-------|------|--------|
| `/` | Dashboard overview | EXISTS — restructure layout |
| `/intelligence` | Apex Intelligence Brain | EXISTS |
| `/analytics` | Platform analytics | EXISTS |

### Section 2: Contacts & CRM
| Route | Page | Status |
|-------|------|--------|
| `/contacts` | Contact list | EXISTS |
| `/contacts/:id` | Contact detail | EXISTS |
| `/contacts/import` | Bulk import | EXISTS |
| `/contacts/enrichment` | Enrichment queue | EXISTS |
| `/pipeline` | CRM pipeline/kanban | EXISTS |
| `/conversations` | Inbox view | EXISTS |

### Section 3: Signals
| Route | Page | Status |
|-------|------|--------|
| `/signals` | Signal dashboard | EXISTS |
| `/signals/legal` | Legal signals | EXISTS |
| `/signals/legal/:id` | Case detail | EXISTS |
| `/signals/home-service` | Home service signals | EXISTS |
| `/signals/sentinel` | Sentinel incidents | EXISTS |
| `/signals/sentinel/:id` | Incident detail | EXISTS |
| `/signals/arrest` | Arrest bookings | EXISTS |

### Section 4: Automate
| Route | Page | Status |
|-------|------|--------|
| `/workflows` | Workflow list | EXISTS |
| `/workflows/:id` | Workflow editor | EXISTS |
| `/agents` | Agent list | EXISTS |
| `/agents/:id` | Agent config | EXISTS |
| `/automations` | Automation rules | EXISTS |

### Section 5: Grow
| Route | Page | Status |
|-------|------|--------|
| `/websites` | Website builder | EXISTS |
| `/funnels` | Funnel list | EXISTS |
| `/funnels/:id` | Funnel editor | EXISTS |
| `/forms` | Form list | EXISTS |
| `/ads` | Ad campaign manager | EXISTS |
| `/content` | Content planner | EXISTS |
| `/content/social` | Social calendar | EXISTS |

### Section 6: Deliver
| Route | Page | Status |
|-------|------|--------|
| `/distribution` | Lead routing | EXISTS |
| `/distribution/rules` | Routing rules | EXISTS |
| `/cards` | Digital cards | EXISTS |
| `/cards/:id` | Card builder | EXISTS |

### Section 7: Account & Billing
| Route | Page | Status |
|-------|------|--------|
| `/settings` | Account settings | EXISTS |
| `/settings/billing` | Billing & plan | EXISTS |
| `/settings/team` | Team management | EXISTS |
| `/settings/integrations` | Connected apps | EXISTS |

### Admin Section (role-gated)
| Route | Page | Status |
|-------|------|--------|
| `/admin` | Admin dashboard | EXISTS |
| `/admin/accounts` | Account management | EXISTS |
| `/admin/users` | User management | EXISTS |
| `/admin/pipelines` | Pipeline monitor | EXISTS |
| `/admin/feature-flags` | Feature flag editor | EXISTS |

---

## Component Architecture Changes

### 1. Navigation Component (`AppSidebar`)

Current: Flat list of links
Target: Grouped sections with collapsible sub-menus

```typescript
// Target structure for sidebar nav config:
const NAV_SECTIONS = [
  {
    label: 'Contacts',
    icon: Users,
    items: [
      { label: 'All Contacts', href: '/contacts' },
      { label: 'Pipeline', href: '/pipeline' },
      { label: 'Inbox', href: '/conversations' },
      { label: 'Enrichment', href: '/contacts/enrichment' },
    ]
  },
  {
    label: 'Signals',
    icon: Zap,
    items: [
      { label: 'Legal Cases', href: '/signals/legal' },
      { label: 'Home Service', href: '/signals/home-service' },
      { label: 'Sentinel', href: '/signals/sentinel' },
    ]
  },
  // ... etc
];
```

### 2. Auth Guard (`ProtectedRoute`)

Current: Checks `user.is_admin === 'true'` (string comparison)
Target: Checks `user.role` enum with fallback to `is_admin` string

```typescript
// New: role-aware guard
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'owner' || user?.is_admin === 'true';
  if (!isAdmin) return <Navigate to="/" />;
  return <>{children}</>;
}
```

### 3. Global Search (`CommandPalette`)

New component: `client/src/components/CommandPalette.tsx`
- Triggered by `Cmd+K` / `Ctrl+K`
- Searches contacts, cases, conversations, workflows, pages
- Uses TanStack Query with debounced input
- Renders results grouped by type

### 4. Plan Gate (`PlanGate`)

Current: Ad-hoc checks scattered across components
Target: Centralized `PlanGate` wrapper

```typescript
function PlanGate({ 
  requiredTier, 
  children, 
  fallback 
}: { 
  requiredTier: 'starter' | 'pro' | 'enterprise';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { account } = useAccount();
  const tierOrder = { starter: 0, pro: 1, enterprise: 2 };
  const has = tierOrder[account.planTier] >= tierOrder[requiredTier];
  return has ? <>{children}</> : (fallback ?? <UpgradePrompt tier={requiredTier} />);
}
```

---

## Mobile Responsiveness Plan

Priority pages for mobile audit (in order):

1. `/conversations` (Inbox) — field agents use on mobile
2. `/contacts/:id` (Contact detail) — primary lookup tool
3. `/signals/sentinel` (Sentinel list) — alert response
4. `/signals/legal/:id` (Case detail) — field reference
5. Dashboard `/` — daily overview

**Each page must pass:**
- No horizontal scroll on 375px viewport
- Touch targets ≥ 44px
- Bottom navigation available on mobile (replace sidebar)

---

## Implementation Sequence

### Sprint 1 (No-risk: Additive only)
1. Add `PlanGate` component — wrap existing paywalled features
2. Fix `AdminRoute` to handle both `role` and `is_admin` string
3. Add `Cmd+K` command palette stub (search backend wired later)

### Sprint 2 (Nav restructure)
4. Add nav section grouping to sidebar — preserving all existing routes
5. Add admin section visibility check
6. Add mobile bottom nav component

### Sprint 3 (Module cleanup)
7. Audit and retire dead pages (pages with 0 navigation links pointing to them)
8. Standardize page layout headers (breadcrumbs, action buttons, titles)
9. Add loading/error boundary to each section

### Sprint 4 (Search)
10. Wire global search API endpoint
11. Complete command palette with real results

---

*Document complete. Next: `docs/APEX_API_RESTRUCTURE_PLAN.md` (Phase 6)*
