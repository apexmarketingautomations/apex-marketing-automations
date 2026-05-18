# APEX Route Map
**Last Updated:** 2026-05-18  
**Source:** server/routes.ts + server/routes/*.ts

---

## Auth
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/auth/login | None | routes/auth.ts |
| POST | /api/auth/logout | Session | routes/auth.ts |
| GET | /api/auth/user | Session | routes/auth.ts |
| POST | /api/auth/firebase | None | routes/auth.ts |

## Accounts / Sub-accounts
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/accounts | Admin | routes/accounts.ts |
| GET | /api/accounts/:id | verifyOwner | routes/accounts.ts |
| POST | /api/accounts | Session | routes/accounts.ts |
| PATCH | /api/accounts/:id | Session | routes/reviews.ts |
| GET | /api/accounts/:id/from-email-status | verifyOwner | routes/reviews.ts |
| POST | /api/accounts/:id/from-email-verify | verifyOwner | routes/reviews.ts |

## Reviews / Reputation
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/reviews/:subAccountId | verifyOwner | routes/reviews.ts |
| POST | /api/reviews | Session | routes/reviews.ts |
| PATCH | /api/reviews/:id | Session | routes/reviews.ts |
| POST | /api/alert-owner | None (internal) | routes/reviews.ts |
| GET | /api/review-config/:subAccountId | verifyOwner | routes/reviews.ts |
| PATCH | /api/review-config/:subAccountId | verifyOwner | routes/reviews.ts |

## Domains
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/domains/check | None | routes/reviews.ts |
| POST | /api/domains/search | None | routes/reviews.ts |
| POST | /api/domains/purchase | verifyOwner | routes/reviews.ts |
| GET | /api/domains/:subAccountId | verifyOwner | routes/reviews.ts |
| PATCH | /api/domains/:id | verifyOwner | routes/reviews.ts |
| POST | /api/domains/:id/verify | verifyOwner | routes/reviews.ts |
| POST | /api/domains/:id/check-verification | verifyOwner | routes/reviews.ts |
| POST | /api/domains/:id/configure-ssl | verifyOwner | routes/reviews.ts |
| GET | /api/domains/:id/status | verifyOwner | routes/reviews.ts |

## Usage / Billing / Wallet
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/usage/log | verifyOwner | routes/reviews.ts |
| GET | /api/usage/:subAccountId | verifyOwner | routes/reviews.ts |
| GET | /api/wallet/:subAccountId | verifyOwner | routes/reviews.ts |
| GET | /api/wallet/:subAccountId/transactions | verifyOwner | routes/reviews.ts |
| POST | /api/wallet/topup | Session | routes/reviews.ts |
| POST | /api/wallet/deduct | Session | routes/reviews.ts |

## Sponsorships / Ads
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/sponsorships | isAdmin | routes/reviews.ts |
| GET | /api/sponsorships/:id | isAdmin | routes/reviews.ts |
| POST | /api/sponsorships | isAdmin | routes/reviews.ts |
| PATCH | /api/sponsorships/:id | isAdmin | routes/reviews.ts |
| GET | /api/v1/serve-native-ad | None | routes/reviews.ts |
| POST | /api/v1/ad-click/:id | None | routes/reviews.ts |

## Admin
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/admin/profit-report | isAdmin | routes/reviews.ts |
| GET | /api/admin/pulse | isAdmin | routes/reviews.ts |
| GET | /api/admin/message-failures | isAdmin | routes/reviews.ts |
| POST | /api/admin/reboot | isAdmin | routes/reviews.ts |

## Messaging
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/messages/send | verifyOwner | routes/messaging.ts |
| GET | /api/messages/:subAccountId | verifyOwner | routes/messaging.ts |
| POST | /api/webhooks/twilio | TwilioSig | routes/messaging.ts |
| POST | /api/webhooks/vapi | None | routes/reviews.ts |

## Sentinel / Crash Intelligence
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/sentinel/config/:subAccountId | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/scan | verifyOwner + plan | routes/sentinel.ts |
| GET | /api/sentinel/incidents/:subAccountId | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/incidents | Session | routes/sentinel.ts |
| POST | /api/sentinel/incidents/:id/deploy-geofence | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/incidents/:id/send-sms | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/incidents/:id/acknowledge | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/incidents/:id/flag-lead | verifyOwner | routes/sentinel.ts |
| GET | /api/sentinel/live | Session | routes/sentinel.ts |
| POST | /api/sentinel/cad-ingest | AdminSecret | routes/sentinel.ts |
| GET | /api/sentinel/legal-signals | verifyOwner | routes/sentinel.ts |
| GET | /api/sentinel/distribution-rules | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/distribution-rules | verifyOwner | routes/sentinel.ts |
| PATCH | /api/sentinel/distribution-rules/:id | verifyOwner | routes/sentinel.ts |
| POST | /api/sentinel/enrich-legal-signals | Session | routes/sentinel.ts |
| GET | /api/sentinel/pipeline-status | None (TODO: add auth) | routes/sentinel.ts |
| GET | /api/legal/attorneys | **None (RISK)** | routes/sentinel.ts |
| POST | /api/legal/attorneys/scrape | **None (RISK)** | routes/sentinel.ts |
| POST | /api/admin/backfill-lead-classification | isAdmin | routes/sentinel.ts |
| POST | /api/admin/manual-skip-trace | isAdmin | routes/sentinel.ts |
| POST | /api/sentinel/retro-skip-trace | AdminSecret | routes/sentinel.ts |
| POST | /api/internal/retro-flhsmv-enrich | AdminSecret | routes/sentinel.ts |
| GET | /api/internal/pipeline-health | AdminSecret | routes/sentinel.ts |
| GET | /api/internal/ai-health | Session | routes/sentinel.ts |

## Legal Signal Pipeline
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/legal-leads | **FIXED: isPlatformAdmin + subAccountId** | routes.ts |
| GET | /api/legal-signals/stats | None | routes.ts |
| GET | /api/cases | None | routes.ts |
| GET | /api/cases/:id | None | routes.ts |

## Dynamic Pages
| Method | Path | Auth | File |
|---|---|---|---|
| POST | /api/dynamic-pages/generate | subscription | routes/dynamicPages.ts |
| POST | /api/dynamic-pages/patch | subscription | routes/dynamicPages.ts |
| GET | /api/dynamic-pages/schemas/:subAccountId | subscription | routes/dynamicPages.ts |
| POST | /api/dynamic-pages/schemas | subscription | routes/dynamicPages.ts |
| PATCH | /api/dynamic-pages/schemas/:schemaId/publish | subscription | routes/dynamicPages.ts |
| DELETE | /api/dynamic-pages/schemas/:schemaId | subscription | routes/dynamicPages.ts |
| GET | /api/dynamic-pages/schemas/:schemaId/structured-data | None | routes/dynamicPages.ts |
| GET | /api/dynamic-pages/admin/all | isPlatformAdmin | routes/dynamicPages.ts |
| GET | /robots.txt | None | routes/dynamicPages.ts |
| GET | /sitemap.xml | None | routes/dynamicPages.ts |
| GET | /llms.txt | None | routes/dynamicPages.ts |

## Digital Cards
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/cards/:subAccountId | verifyOwner | routes/cards.ts |
| POST | /api/cards | verifyOwner | routes/cards.ts |
| PATCH | /api/cards/:id | verifyOwner | routes/cards.ts |
| DELETE | /api/cards/:id | verifyOwner | routes/cards.ts |
| GET | /card/:slug | None (public) | routes/cards.ts |
| GET | /api/cards/:id/vcard | None (public) | routes/cards.ts |
| POST | /api/cards/checkout | verifyOwner | routes/cards.ts |
| POST | /api/webhooks/stripe | StripeSig | routes/cards.ts |

## Sites
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/sites/:subAccountId | verifyOwner | routes/sites.ts |
| POST | /api/sites | verifyOwner | routes/sites.ts |
| PATCH | /api/sites/:id | verifyOwner | routes/sites.ts |
| DELETE | /api/sites/:id | verifyOwner | routes/sites.ts |
| GET | /s/:slug | None (public) | routes/sites.ts |

## Meta / Facebook
| Method | Path | Auth | File |
|---|---|---|---|
| GET | /api/meta/auth-url | Session | routes/meta.ts |
| GET | /api/meta/callback | Session | routes/meta.ts |
| GET | /api/meta/pages/:subAccountId | verifyOwner | routes/meta.ts |
| POST | /api/meta/webhook | MetaVerify | routes/meta.ts |
| POST | /api/meta/ads | verifyOwner | routes/meta.ts |

## Public Routes (no auth required)
| Method | Path | Notes |
|---|---|---|
| GET | /card/:slug | Digital card public view |
| GET | /s/:slug | Published site view |
| GET | /robots.txt | Dynamic per tenant |
| GET | /sitemap.xml | Published pages only |
| GET | /llms.txt | Published pages only |
| GET | /api/v1/serve-native-ad | Native ad serving |
| POST | /api/webhooks/* | Verified via provider signatures |
