# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script with auto-restart loop
# Secrets are passed via stdin JSON — temp file is deleted immediately after Node reads it
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN cat > /app/entrypoint.sh <<'EOF'
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
EOF
RUN chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
