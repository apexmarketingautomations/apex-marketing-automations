#!/bin/bash
set -e

npm install --no-audit --no-fund
npm run db:push --force 2>/dev/null || npm run db:push
