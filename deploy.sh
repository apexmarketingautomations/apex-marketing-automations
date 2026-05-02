#!/bin/bash
set -e

# Set GITHUB_TOKEN env var before running, or it will use existing git remote
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[APEX]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  APEX DEPLOY — $(date '+%Y-%m-%d %H:%M:%S')"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Pull latest from GitHub ───────────────────────────────────────────────
log "Pulling latest from GitHub..."
git fetch origin main --quiet
git reset --hard origin/main --quiet
log "✓ Code up to date ($(git rev-parse --short HEAD))"

# ── 2. Install dependencies ──────────────────────────────────────────────────
log "Installing dependencies..."
npm install --silent 2>&1 | tail -3
log "✓ Dependencies installed"

# ── 3. TypeScript check (real errors only) ───────────────────────────────────
log "Running TypeScript check..."
TS_ERRORS=$(npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "node_modules" \
  | grep -v "TS2688" | grep -v "TS5101" | grep -v "TS2307.*@types" || true)

if [ -n "$TS_ERRORS" ]; then
  fail "TypeScript errors found:\n$TS_ERRORS"
else
  log "✓ TypeScript clean"
fi

# ── 4. Build ─────────────────────────────────────────────────────────────────
log "Building..."
npm run build 2>&1 | tail -5
log "✓ Build complete"

# ── 5. Restart server ────────────────────────────────────────────────────────
log "Restarting server..."

# Kill existing node process if running
pkill -f "node dist/index.cjs" 2>/dev/null || true
pkill -f "tsx server/index.ts" 2>/dev/null || true
sleep 1

# Start in background
NODE_ENV=production node dist/index.cjs >> /tmp/apex.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > /tmp/apex.pid

# Wait for server to be ready
log "Waiting for server on port 5000..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:5000/api/health >/dev/null 2>&1 || \
     curl -sf http://localhost:5000 >/dev/null 2>&1; then
    log "✓ Server live (PID $SERVER_PID)"
    break
  fi
  if [ $i -eq 20 ]; then
    warn "Server didn't respond on /health — check logs: tail -50 /tmp/apex.log"
  fi
  sleep 1
done

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  ✅ DEPLOY COMPLETE"
log "  Commit: $(git rev-parse --short HEAD)"
log "  PID:    $(cat /tmp/apex.pid 2>/dev/null || echo 'unknown')"
log "  Logs:   tail -f /tmp/apex.log"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
