# Mega Cycle (Apex Intelligence)

Mega Cycle is a disciplined autonomy loop that runs *inside* Apex Intelligence.

Think of it as: **scheduler + depth discipline + must-ship guardrails**, wired into the same action feed / outcomes stream as the rest of Apex Intelligence.

It is **OFF by default**.

## What It Does (Capabilities)

In each cycle, Mega Cycle:

1. Chooses one focus domain (rotates) for the target `subAccountId`.
2. Runs a small diagnostic or maintenance task for that domain.
3. Emits a durable **Apex Intelligence outcome** (eventType `agent.outcome`, agentName `mega-cycle`).

Supported domains (initial wiring):

- `health`: system health snapshot via `getSystemHealthReport()`.
- `security`: secrets scan (`npm run check:secrets`) when enabled via `MEGA_CYCLE_ALLOW_SHELL=true`.
- `web`: placeholder domain reserved for UI polish automation (screenshots/perf budgets).
- `data-integrity`: placeholder domain reserved for DB audits (duplicates/orphans/tenant leaks).
- `ingestion`: placeholder domain reserved for pipeline heartbeat + backlog checks.

## Safety & Modes

`MEGA_CYCLE_MODE`:

- `observe` (default): produces outcomes/telemetry only.
- `propose`: reserved for future "open PRs" automation.
- `ship`: reserved for future auto-merge flows (should remain locked down).

Shell execution is **disabled** unless you explicitly set:

- `MEGA_CYCLE_ALLOW_SHELL=true`

This prevents accidentally running expensive local commands in production.

## Configuration (Env Vars)

- `MEGA_CYCLE_ENABLED=true|false` (default: false)
- `MEGA_CYCLE_SUB_ACCOUNT_ID=3` (default: `APEX_PARENT_ACCOUNT_ID` or 3)
- `MEGA_CYCLE_WAKEUP_SECONDS=900` (default: 900, minimum 60)
- `MEGA_CYCLE_MODE=observe|propose|ship` (default: observe)
- `MEGA_CYCLE_DOMAINS=health,security,web` (optional, comma-separated)
- `MEGA_CYCLE_ALLOW_SHELL=true|false` (default: false)

## API

Trigger a tick:

- `POST /api/intelligence/mega-cycle/run`
  - body: `{ subAccountId, mode?, domains? }`

Read status:

- `GET /api/intelligence/mega-cycle/status/:subAccountId`

## Where Outcomes Show Up

Mega Cycle uses `reportOutcome()` with:

- `agentName`: `mega-cycle`
- `action`: `cycle_completed`
- `subject`: the domain that ran
- `result`: short summary (trimmed)

This makes Mega Cycle visible anywhere you already show agent outcomes / intelligence events.

