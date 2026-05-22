# Clerk Traffic Actor

This actor is the browser half of `/Users/apexmarketingautomations/apex-marketing-automations/server/clerkTrafficEnrich.ts`.

It exists to recover **public traffic case identity data** from county clerk portals when a crash-related citation becomes a court case. That gives Apex a second path to a real name and mailing address while FLHSMV is delayed, blocked, or down.

Important:

- This actor **does not fetch police report PDFs**
- This actor **does fetch public traffic-case data**
- The initial priority county is **LEE**

## Primary Target

- Lee County Clerk case search: [https://matrix.leeclerk.org/](https://matrix.leeclerk.org/)

Secondary targets already supported by the orchestration code:

- Collier County
- Charlotte County

## Actor Input

```json
{
  "county": "LEE",
  "portalUrl": "https://matrix.leeclerk.org/",
  "daysBack": 7
}
```

## Required Dataset Output

Each dataset row must match the `ClerkCitationRow` contract expected by `/Users/apexmarketingautomations/apex-marketing-automations/server/clerkTrafficEnrich.ts`.

```json
{
  "caseNumber": "24-TR-012345",
  "defendantName": "DOE, JANE",
  "defendantAddress": "123 MAIN ST",
  "defendantCity": "CAPE CORAL",
  "defendantState": "FL",
  "defendantZip": "33990",
  "citationDate": "2026-05-20",
  "county": "LEE",
  "chargeText": "CARELESS DRIVING",
  "citingAgency": "Cape Coral Police Department",
  "offenseLocation": "DEL PRADO BLVD / PINE ISLAND RD"
}
```

Only emit rows that actually represent traffic/citation cases. The orchestration layer handles crash-related filtering, dedupe, and contact upsert.

## Lee County Browser Workflow

1. Open `portalUrl`
2. Navigate into public case search
3. Restrict to traffic / citation / criminal traffic style case classes if the portal exposes them
4. Set filing / citation date range to the last `daysBack` days
5. Search
6. Paginate through all results in range
7. For each result, open the detail page if needed and extract:
   - case number
   - defendant name
   - mailing address
   - citation date
   - charge text
   - citing agency
   - offense location
8. Return dataset rows only

## Actor Behavior Rules

- Use a full browser session, not raw HTTP form posts
- Preserve cookies/session across the search flow
- Wait for JS-rendered results
- Deduplicate by `caseNumber`
- Prefer exact portal values over inferred values
- If address is unavailable, still emit the row with `defendantName`, `caseNumber`, `county`, and whatever fields are available
- Never invent names, agencies, or locations

## Recommended Runtime Strategy

- Playwright actor
- Residential proxy if Lee Clerk starts challenging datacenter IPs
- Conservative concurrency (`1-2`)
- Retries only for navigation/network failures, not “no results”

## Wiring Into Apex

After the actor is published in Apify:

1. Set `APIFY_CLERK_TRAFFIC_ACTOR_ID` in Railway
2. Keep `APIFY_API_KEY` configured
3. Apex will begin running this lane through:
   - scheduler startup in `/Users/apexmarketingautomations/apex-marketing-automations/server/index.ts`
   - manual trigger at `POST /api/internal/retro-clerk-enrich`

## Verification

Use the admin route:

`POST /api/internal/retro-clerk-enrich`

Body:

```json
{
  "counties": ["LEE"],
  "daysBack": 7,
  "dryRun": false
}
```

Expected result:

- `clerk_traffic` contacts are upserted
- source external ids look like `clerk:LEE:<caseNumber>`
- leads carry verified names and court mailing addresses
