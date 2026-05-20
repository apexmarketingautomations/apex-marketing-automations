#!/bin/bash
# Runs every 15 minutes via launchd.
# Opens the FLHSMV crash report page in Safari (your residential IP bypasses Akamai),
# grabs the session cookies via JavaScript, and pushes them to Railway.

RAILWAY_URL="https://apexmarketingautomations.com/api/admin/flhsmv-cookie"
ADMIN_SECRET="201120062017"
FLHSMV_URL="https://services.flhsmv.gov/crashreportrequest/"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

log "Opening FLHSMV crash report page in Safari..."

# Open the page and wait for it to load, then grab all cookies via JS
COOKIE=$(osascript <<'APPLESCRIPT'
tell application "Safari"
    -- Open in a new tab behind current window
    set theURL to "https://services.flhsmv.gov/crashreportrequest/"
    tell window 1
        set newTab to make new tab with properties {URL:theURL}
        set current tab to newTab
    end tell
    -- Wait for page to load (ASP.NET session is set server-side, JS just confirms load)
    delay 8
    -- Grab all cookies available to JS (ASP.NET_SessionId is Lax so it IS accessible)
    set cookieStr to do JavaScript "document.cookie" in current tab of window 1
    -- Close the tab
    tell window 1
        close current tab
    end tell
    return cookieStr
end tell
APPLESCRIPT
)

if [ -z "$COOKIE" ]; then
    log "ERROR: Got empty cookie string from Safari"
    exit 1
fi

if [[ "$COOKIE" != *"ASP.NET_SessionId"* ]]; then
    log "ERROR: ASP.NET_SessionId not found in cookies: $COOKIE"
    exit 1
fi

log "Got cookies (${#COOKIE} chars), pushing to Railway..."

RESPONSE=$(curl -s -X POST "$RAILWAY_URL" \
    -H "x-admin-secret: $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"cookie\": $(echo "$COOKIE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))')}" \
    --max-time 15)

if echo "$RESPONSE" | grep -q '"ok":true'; then
    log "SUCCESS: Cookie pushed to Railway"
else
    log "ERROR: Railway push failed: $RESPONSE"
    exit 1
fi
