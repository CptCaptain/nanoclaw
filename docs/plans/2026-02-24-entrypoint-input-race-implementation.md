# Entrypoint Input Race Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `container/entrypoint.sh` exit cleanly when `/tmp/input.json` is missing (including TOCTOU launch races), while simplifying restart-budget logic.

**Architecture:** Keep the current bash loop and stdin redirection model, but capture startup stderr for each launch attempt so we can classify missing-input launch failures as expected completion. Extract restart-threshold enforcement into a dedicated helper function to reduce loop complexity.

**Tech Stack:** Bash (`container/entrypoint.sh`), Vitest (lightweight regression guard), Node.js tooling (`npm`, `vitest`).

---

> Relevant skills: @superpowers:test-driven-development, @superpowers:verification-before-completion

### Task 1: Add failing regression test for script structure/behavior markers

**Files:**
- Create: `container/entrypoint.test.ts`
- Test: `container/entrypoint.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'fs';

describe('container/entrypoint.sh', () => {
  const script = fs.readFileSync('container/entrypoint.sh', 'utf8');

  it('extracts restart budget check into a helper', () => {
    expect(script).toContain('check_restart_budget()');
    expect(script).toContain('check_restart_budget');
  });

  it('handles input disappearing during launch as clean completion', () => {
    expect(script).toContain('Input file disappeared during launch, treating turn as complete');
    expect(script).toContain('if [ ! -f /tmp/input.json ]; then');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- container/entrypoint.test.ts`
Expected: FAIL because helper and TOCTOU log marker are not yet present.

**Step 3: Commit failing test**

```bash
git add container/entrypoint.test.ts
git commit -m "test(entrypoint): add regression guard for input race handling"
```

### Task 2: Implement TOCTOU-safe missing-input handling + restart helper refactor

**Files:**
- Modify: `container/entrypoint.sh`
- Test: `container/entrypoint.test.ts`

**Step 1: Write minimal implementation**

Replace loop internals with helper + stderr-capture launch classification:

```bash
check_restart_budget() {
  local current_time
  local time_diff

  current_time=$(date +%s)
  time_diff=$((current_time - RESTART_WINDOW_START))

  if [ $time_diff -lt 60 ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ $RESTART_COUNT -ge $MAX_RESTARTS_PER_MINUTE ]; then
      echo "[$(date -Iseconds)] ERROR: Too many restarts ($RESTART_COUNT in ${time_diff}s). Possible crash loop. Exiting."
      exit 1
    fi
  else
    RESTART_COUNT=1
    RESTART_WINDOW_START=$current_time
  fi
}

while true; do
  if [ ! -f /tmp/input.json ]; then
    echo "[$(date -Iseconds)] Input file consumed before launch, exiting container cleanly"
    exit 0
  fi

  NODE_STDERR_FILE=$(mktemp)

  echo "[$(date -Iseconds)] Starting node process..."
  if node /tmp/dist/index.js < /tmp/input.json 2>"$NODE_STDERR_FILE"; then
    EXIT_CODE=0
  else
    EXIT_CODE=$?
  fi

  if [ $EXIT_CODE -ne 0 ] && [ ! -f /tmp/input.json ]; then
    rm -f "$NODE_STDERR_FILE"
    echo "[$(date -Iseconds)] Input file disappeared during launch, treating turn as complete"
    exit 0
  fi

  if [ -s "$NODE_STDERR_FILE" ]; then
    cat "$NODE_STDERR_FILE" >&2
  fi
  rm -f "$NODE_STDERR_FILE"

  echo "[$(date -Iseconds)] Node exited with code $EXIT_CODE"
  check_restart_budget
  sleep 1
done
```

**Step 2: Run targeted test to verify it passes**

Run: `npm test -- container/entrypoint.test.ts`
Expected: PASS.

**Step 3: Commit implementation**

```bash
git add container/entrypoint.sh container/entrypoint.test.ts
git commit -m "fix(entrypoint): handle input race on launch and simplify restart logic"
```

### Task 3: Final verification before handoff

**Files:**
- Verify: `container/entrypoint.sh`
- Verify: `container/entrypoint.test.ts`

**Step 1: Shell syntax check**

Run: `bash -n container/entrypoint.sh`
Expected: exit code 0, no output.

**Step 2: Run focused test file again**

Run: `npm test -- container/entrypoint.test.ts`
Expected: PASS.

**Step 3: Run project build**

Run: `npm run build`
Expected: TypeScript build succeeds.

**Step 4: Commit verification-only adjustments (if any)**

```bash
git add -A
git commit -m "chore: finalize entrypoint race-handling verification" || true
```
