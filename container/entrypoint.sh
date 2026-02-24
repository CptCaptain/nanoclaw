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

check_restart_budget() {
  local current_time time_diff

  current_time=$(date +%s)
  time_diff=$((current_time - RESTART_WINDOW_START))

  if [ "$time_diff" -lt 60 ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS_PER_MINUTE" ]; then
      echo "[$(date -Iseconds)] ERROR: Too many restarts ($RESTART_COUNT in ${time_diff}s). Possible crash loop. Exiting."
      exit 1
    fi
  else
    RESTART_COUNT=1
    RESTART_WINDOW_START=$current_time
  fi
}

# Auto-restart loop
while true; do
  if [ ! -f /tmp/input.json ]; then
    echo "[$(date -Iseconds)] Input file missing before launch, treating turn as complete"
    exit 0
  fi

  echo "[$(date -Iseconds)] Starting node process..."

  launch_stderr=$(mktemp)
  if node /tmp/dist/index.js < /tmp/input.json 2>"$launch_stderr"; then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi

  if [ "$EXIT_CODE" -ne 0 ]; then
    if [ ! -f /tmp/input.json ]; then
      echo "[$(date -Iseconds)] Input file disappeared during launch, treating turn as complete"
      rm -f "$launch_stderr"
      exit 0
    fi

    cat "$launch_stderr" >&2
  fi

  rm -f "$launch_stderr"

  echo "[$(date -Iseconds)] Node exited with code $EXIT_CODE"
  check_restart_budget
  sleep 1
done
