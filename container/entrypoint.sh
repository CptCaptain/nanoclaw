#!/bin/bash
set -e
cd /app && npx tsc --outDir /tmp/dist 2>&1 >&2
ln -s /app/node_modules /tmp/dist/node_modules
chmod -R a-w /tmp/dist

# Save input once at startup
cat > /tmp/input.json

# Restart loop protection
MAX_RESTARTS_PER_MINUTE=10
RESTART_COUNT=0
RESTART_WINDOW_START=$(date +%s)

# Auto-restart loop
while true; do
  echo "[$(date -Iseconds)] Starting node process..."
  node /tmp/dist/index.js < /tmp/input.json
  EXIT_CODE=$?
  echo "[$(date -Iseconds)] Node exited with code $EXIT_CODE"

  # Check for restart loop
  CURRENT_TIME=$(date +%s)
  TIME_DIFF=$((CURRENT_TIME - RESTART_WINDOW_START))

  if [ $TIME_DIFF -lt 60 ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ $RESTART_COUNT -ge $MAX_RESTARTS_PER_MINUTE ]; then
      echo "[$(date -Iseconds)] ERROR: Too many restarts ($RESTART_COUNT in ${TIME_DIFF}s). Possible crash loop. Exiting."
      exit 1
    fi
  else
    # Reset counter if we're past the window
    RESTART_COUNT=1
    RESTART_WINDOW_START=$CURRENT_TIME
  fi

  sleep 1
done
