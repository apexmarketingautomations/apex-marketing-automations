# Lee Clerk Traffic Lane

## Purpose

This lane gives Apex a **Lee County crash identity backup path** that does not depend on FLHSMV.

It works by scraping **public traffic/citation court cases** from Lee County Clerk and turning crash-related citations into verified-name leads.

## What It Gets

- defendant name
- mailing address when public
- case number
- citation date
- charge text
- citing agency
- offense location

## What It Does Not Get

- police report PDFs
- FLHSMV official crash detail payloads
- confidential victim names from crash reports

So this lane is best understood as:

`incident discovery -> Lee clerk traffic case -> verified at-fault identity`

not:

`incident discovery -> police report PDF`

## Current Apex Wiring

- Scheduler: `/Users/apexmarketingautomations/apex-marketing-automations/server/index.ts`
- Orchestration: `/Users/apexmarketingautomations/apex-marketing-automations/server/clerkTrafficEnrich.ts`
- Manual trigger: `POST /api/internal/retro-clerk-enrich`
- Actor scaffold: `/Users/apexmarketingautomations/apex-marketing-automations/apify-actors/clerk-traffic/README.md`

## Required Env

- `APIFY_API_KEY`
- `APIFY_CLERK_TRAFFIC_ACTOR_ID`

If `APIFY_CLERK_TRAFFIC_ACTOR_ID` is missing, the lane is a safe no-op.

## Why Lee First

Lee County is the highest-value SWFL county for the crash pipeline, and the repo already has:

- Lee Sheriff traffic incident feed for discovery
- Lee Clerk portal target for case identity recovery

That makes Lee the cleanest county to operationalize first.

## Recommended Operating Flow

1. Lee Sheriff traffic feed discovers the incident
2. Sentinel / crash pipeline creates the crash placeholder
3. Lee Clerk traffic actor searches the last `N` days of public traffic cases
4. Crash-related citations are upserted as `clerk_traffic` contacts
5. Staff or automation uses those verified identities while FLHSMV is delayed
6. Police report PDFs, when acquired separately, are stored through the police-report document lane

## Runbook

### 1. Publish the Apify actor

Use the actor contract under:

- `/Users/apexmarketingautomations/apex-marketing-automations/apify-actors/clerk-traffic/README.md`

### 2. Configure Railway

Set:

- `APIFY_CLERK_TRAFFIC_ACTOR_ID=<your actor id>`

### 3. Verify readiness

Check:

- `GET /api/internal/pipeline-health`
- `GET /api/crash-reports/health`

Look for `clerkTraffic.ready = true`.

### 4. Run the lane manually

```bash
curl -X POST https://apexmarketingautomations.com/api/internal/retro-clerk-enrich \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: <STANDALONE_ADMIN_SECRET>" \
  -d '{"counties":["LEE"],"daysBack":7,"dryRun":false}'
```

### 5. Confirm output

Expected:

- new contacts sourced `clerk_traffic`
- `sourceExternalId = clerk:LEE:<caseNumber>`
- notes mention the public citation and citing agency

## Next Follow-On For Actual Police Reports

This Lee Clerk lane should be paired with one of:

- Lee Sheriff records acquisition
- Cape Coral PD records workflow
- Fort Myers PD records workflow
- manual police report PDF upload into Apex

That is how we get from **identity recovery** to **actual police report documents**.
