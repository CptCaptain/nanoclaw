# Work Timer Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove redundant custom image extension and deliver a minimal, elegant work-timer footer with toggleable session/rolling bars plus dual-target JSONL analytics.

**Architecture:** Keep one extension (`~/.pi/agent/extensions/work-timer-status.ts`) that owns timing state, footer status, mode toggling, and best-effort logging. Model time as explicit `work` and `idle-pending` transitions, where idle is only committed on next user input and dropped if trailing. Use lightweight pure helpers for formatting and interval math so behavior is testable.

**Tech Stack:** pi extension API, TypeScript, Node fs/path APIs, Vitest (for helper logic), pi command reload/smoke checks.

---

### Task 1: Remove custom image extension (built-in tool fallback)

**Files:**
- Delete: `/home/nils/.pi/agent/extensions/nano-banana-image-gen.ts`

**Step 1: Write the failing test (safety check script)**

Create a tiny check script:
```bash
cat > /tmp/check-generate-image-tool.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ -f /home/nils/.pi/agent/extensions/nano-banana-image-gen.ts ]; then
  echo "FAIL: custom nano extension still present"
  exit 1
fi
echo "PASS: custom nano extension removed"
SH
chmod +x /tmp/check-generate-image-tool.sh
```

**Step 2: Run check to verify it fails first**

Run: `/tmp/check-generate-image-tool.sh`
Expected: `FAIL: custom nano extension still present`

**Step 3: Apply minimal implementation**

Run:
```bash
rm -f /home/nils/.pi/agent/extensions/nano-banana-image-gen.ts
```

**Step 4: Re-run check to verify pass**

Run: `/tmp/check-generate-image-tool.sh`
Expected: `PASS: custom nano extension removed`

**Step 5: Commit (project-side docs state only if tracked)**

```bash
git add -A
git commit -m "chore: remove redundant nano banana extension" || true
```

> Note: global extension path may be outside repo; commit only relevant repo files if any.

---

### Task 2: Refactor timer extension into pure, minimal state model

**Files:**
- Modify: `/home/nils/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Write failing tests for core state helpers**

Add tests for these behaviors (can live in temporary test file):
- `finalizeWorkSegment` increments worked time only for `agent_start -> agent_end`
- idle remains pending after `agent_end`
- pending idle is committed only on next `input`
- pending trailing idle is discarded on shutdown

Example test skeleton:
```ts
import { describe, it, expect } from "vitest";
import {
  commitIdleOnInput,
  closeWorkOnAgentEnd,
  openWorkOnAgentStart,
  discardPendingIdle,
} from "/home/nils/.pi/agent/extensions/work-timer-status";

it("does not count trailing idle", () => {
  // arrange transitions
  // assert idle total excludes open trailing idle
});
```

**Step 2: Run tests to verify RED**

Run: `npx vitest run /tmp/work-timer-status.test.ts`
Expected: failures because helper exports/behavior not implemented yet.

**Step 3: Implement minimal helper layer**

Inside extension, introduce tiny pure helpers and exported types:
```ts
export interface Segment { kind: "work" | "idle"; startMs: number; endMs: number; }
export interface TimerState { workedMsSession: number; idleMsSession: number; pendingIdleStartMs: number | null; workStartMs: number | null; segments: Segment[]; }
```

Implement transitions:
- `onAgentStart(now)` closes pending idle (without committing) and opens work.
- `onAgentEnd(now)` closes work and opens `pendingIdleStartMs`.
- `onInput(now)` commits pending idle delta into session + segments.
- `onShutdown(now)` drops pending idle (no commit).

**Step 4: Run tests to verify GREEN**

Run: `npx vitest run /tmp/work-timer-status.test.ts`
Expected: all pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: simplify work timer state transitions"
```

---

### Task 3: Add toggleable session/rolling bar with tiny indicator

**Files:**
- Modify: `/home/nils/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Write failing tests for rendering and mode toggles**

Cover:
- mode default is `session`
- `/work-timer toggle` flips session <-> rolling
- bar text includes mode marker `[S]` or `[R]`
- working indicator text appears only while active (`Working (...)`), idle uses tiny marker (`·`)

**Step 2: Run RED tests**

Run: `npx vitest run /tmp/work-timer-render.test.ts`
Expected: failures for missing mode logic/render.

**Step 3: Implement minimal rendering + commands + shortcut**

Implement:
- mode enum: `"session" | "rolling"`
- rolling window default `15 * 60_000`
- helper `computeRollingTotals(segments, now, windowMs)`
- command handler:
  - `/work-timer toggle`
  - `/work-timer mode session|rolling`
  - `/work-timer stats`
- shortcut registration: `ctrl+shift+t` => toggle mode
- status render format:
  - `⏱ Working (Xm Ys) ███░░ ... [S]`
  - `⏱ · ███░░ ... [R]`

**Step 4: Run GREEN tests**

Run: `npx vitest run /tmp/work-timer-render.test.ts`
Expected: all pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add toggleable session and rolling work bars"
```

---

### Task 4: Add dual-target JSONL analytics (best effort)

**Files:**
- Modify: `/home/nils/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Write failing tests for logging payload/path behavior**

Cover:
- event payload includes required fields (`ts`, `sessionId`, `event`, mode, session/rolling totals)
- writes attempted to both targets:
  - `~/.pi/agent/logs/work-timer.jsonl`
  - `<repo>/.pi/logs/work-timer.jsonl`
- failure in one target does not throw / block state update

**Step 2: Run RED tests**

Run: `npx vitest run /tmp/work-timer-logging.test.ts`
Expected: failing assertions.

**Step 3: Implement minimal logger**

Add helper:
```ts
async function appendJsonl(paths: string[], event: Record<string, unknown>): Promise<void> {
  // mkdir recursive + appendFile, swallow per-target errors
}
```
Emit on:
- `agent_start`
- `agent_end`
- `input`
- `mode_change`
- periodic snapshot (every 60s)

**Step 4: Run GREEN tests**

Run: `npx vitest run /tmp/work-timer-logging.test.ts`
Expected: all pass.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: log work timer analytics to global and project JSONL"
```

---

### Task 5: End-to-end verification and cleanup

**Files:**
- Verify only (no required file edits)

**Step 1: Run extension compile/load smoke check**

Run:
```bash
timeout 8s bash -lc 'printf "" | pi --mode json --extension /home/nils/.pi/agent/extensions/work-timer-status.ts >/tmp/pi_timer_test.out 2>/tmp/pi_timer_test.err; echo EXIT:$?; tail -n 60 /tmp/pi_timer_test.err'
```
Expected: `EXIT:0` and no extension load error.

**Step 2: Run test suite(s) for timer helpers**

Run: `npx vitest run /tmp/work-timer-status.test.ts /tmp/work-timer-render.test.ts /tmp/work-timer-logging.test.ts`
Expected: all pass.

**Step 3: Manual behavior verification**

In pi interactive session:
1. `/reload`
2. Send prompt, wait, send next prompt.
3. Check footer: working indicator + bar updates.
4. Toggle mode via `/work-timer toggle` and `ctrl+shift+t`.
5. Check logs:
```bash
tail -n 5 ~/.pi/agent/logs/work-timer.jsonl
tail -n 5 .pi/logs/work-timer.jsonl
```
Expected: valid JSONL lines present in both files.

**Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: simplify timer UX and add robust session analytics"
```

**Step 5: Report with evidence**

Include command outputs (exit codes + key lines), mention trailing idle discard behavior explicitly.
